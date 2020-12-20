const async = require('async'),
    kurento = require('kurento-client'),
    fs = require('fs-extra'),
    Promise = require('bluebird'),
    sdpTransform = require('sdp-transform'),
    ffmpeg = require('fluent-ffmpeg');

let encoderSdpRequest = null;
const FILE_NAME = '/home/ubuntu/1080p_3500k.mp4';
encoderSdpRequest = fs.readFileSync(__dirname + '/eo.sdp');
encoderSdpRequest = encoderSdpRequest.toString();
if (encoderSdpRequest instanceof Error) {
    console.log('Error while reading encoder sdp file');
    process.exit(1);
}


class KurentoClient {
    constructor(kurentoWsUrl, ws) {
        this.wsUrl = kurentoWsUrl;
        this.ws = ws;

        // dictionary for holding all current sessions (RtcPeer)
        this.sessions = {};
        // dictionary for holding all the current sessions' ice candidates
        this.iceCandidateFIFO = {};
    }

    // when received an ice candidate from client
    addClientIceCandidate(sessionId, candidate) {
        let parsedCandidate = kurento.getComplexType('IceCandidate')(candidate);

        // if a WebRtcEndpoint has been created for this session
        if (this.sessions[sessionId]) {
            return this.sessions[sessionId].webRtcEndpoint.addIceCandidate(parsedCandidate)
                .then(() => {
                    console.log('addClientIceCandidate() added ice');
                    return Promise.resolve();
                })
                .catch(err => {
                    console.error(`addClientIceCandidate() ${err}`);
                    return err;
                });
        }
        // else, queue the candidate
        else {
            console.log('queue');
            if (!this.iceCandidateFIFO[sessionId]) {
                this.iceCandidateFIFO[sessionId] = [];
            }
            this.iceCandidateFIFO[sessionId].push(parsedCandidate);
        }
    }

    async createPipeline(sessionId, sdpOffer, cb) {
        let self = this,
            _kurentoClient,
            pipeline,
            webRtcEndpoint,
            rtpEndpoint,
            rtpEndpointSdpAnswer,
            webRtcEndpointSdpAnswer,
            encoderState;

        if (KurentoClient.KClient == null) {
            try {
                _kurentoClient = await kurento(this.wsUrl)
                KurentoClient.KClient = _kurentoClient;
                console.log('successfully created kClient');

                pipeline = await KurentoClient.KClient.create('MediaPipeline');
                console.log('successfully created pipeline');

                webRtcEndpoint = await pipeline.create('WebRtcEndpoint');
                //
                // listenning to media flow states
                //
                webRtcEndpoint.on('MediaFlowInStateChange', function (event) {
                    console.log(`WebRtc flow IN: ${event.state}\n`);
                });
                webRtcEndpoint.on('MediaFlowOutStateChange', function (event) {
                    console.log(`WebRtc flow OUT: ${event.state}\n`);
                });
                console.log('successfully created webRtcEndpoint');

                // create session
                self.sessions[sessionId] = {
                    pipeline: pipeline,
                    webRtcEndpoint: webRtcEndpoint
                };

                rtpEndpoint = await pipeline.create('RtpEndpoint');

                rtpEndpoint.on('MediaFlowInStateChange', function (event) {
                    console.log(`Rtp flow IN: ${event.state}\n`);
                });
                rtpEndpoint.on('MediaFlowOutStateChange', function (event) {
                    console.log(`Rtp flow OUT: ${event.state}\n`);
                });
                console.log('successfully create rtpEndpoint');

                rtpEndpoint.setMaxVideoRecvBandwidth(6000);
                rtpEndpointSdpAnswer = await rtpEndpoint.processOffer(encoderSdpRequest);

                console.log(`successfully process sdp from encoder \n\n${rtpEndpointSdpAnswer}`);
                encoderState = await rtpEndpoint.getConnectionState();
                console.log(`encoder connection state: ${encoderState}`);

                webRtcEndpointSdpAnswer = await webRtcEndpoint.processOffer(sdpOffer);
                console.log('successfullty processed sdp offer from client');
                cb(null, webRtcEndpointSdpAnswer);

                console.log(`fifo ${self.iceCandidateFIFO[sessionId].length}`);

                await Promise.each(self.iceCandidateFIFO[sessionId], candidate => {
                    console.log(`${JSON.stringify(candidate)}`);
                    return webRtcEndpoint.addIceCandidate(candidate);
                });
                console.log('All Client ICE Candidate added');

                webRtcEndpoint.on('OnIceCandidate', function (event) {
                    let candidate;
                    console.log('kurento generated ice candidate');

                    candidate = kurento.getComplexType('IceCandidate')(event.candidate);

                    // TODO: implement event-emitter interface instead of this OOP violation
                    self.ws.send(JSON.stringify({
                        id: 'iceCandidate',
                        candidate: candidate
                    }));
                });

                await webRtcEndpoint.gatherCandidates();

                console.log('started gathering ice candidates');
                await rtpEndpoint.connect(webRtcEndpoint);
                console.log('successfully connected endpoints');
                await this.executeRTPStreaming(rtpEndpointSdpAnswer);
                console.log('Source is now streaming RTP');
                return Promise.resolve();

            } catch (err) {
                pipeline.release();
                console.log(`Error occurent while creating pipeline with error ${err}`);
                return err;
            }
        }
    }

    destroyPipeline(sessionId) {
        if (this.sessions[sessionId]) {
            this.sessions[sessionId].pipeline.release();

            delete this.sessions[sessionId];
            delete this.iceCandidateFIFO[sessionId];
        }
    }

    async executeRTPStreaming(sdpAnswer) {
        let destIp,
            destPort,
            parsedSdp,
            command = ffmpeg();

        parsedSdp = await sdpTransform.parse(sdpAnswer);
        destIp = parsedSdp.connection.ip;
        destPort = parsedSdp.media[0].port;
        console.log(parsedSdp);
        command
            .input(FILE_NAME)
            .inputOptions(['-re'])
            .outputOptions(['-c copy', '-f rtp'])
            .on('start', (command) => {
                console.log(`ffmpeg started with the command ${command}`);
            })
            .on('error', (err) => {
                console.log(`ffmpeg failed executing the command with err ${err}`);
            })
            .on('end', () => {
                console.log('ffmpeg finish operation');
            })
            .save(`rtp://${destIp}:${destPort}`);
    }
}

KurentoClient.KClient = null;

// TODO: implement a base class children will implement a rtsp2webRtc and webRtc2WebRtc and so on
module.exports = KurentoClient;
