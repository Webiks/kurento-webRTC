let remoteVideo,
    webRtcPeer;

const ws = new WebSocket('ws://192.168.1.148:8080');

window.onload = () => {
    console.log('Page loaded ...');
    remoteVideo = document.getElementById('remoteVideo');
}

window.onbeforeunload = () => {
    ws.close();
}

ws.onopen = (event) => {
    console.log('Web socket opened');
}

ws.onmessage = (msg) => {
    let { message, candidate, id, sdpAnswer } = JSON.parse(msg.data);

    switch (id) {
        case 'error':
            console.error(message);
            break;

        // add the server's ice candidate to webRtcPeer
        case 'iceCandidate':
            console.log('received ice candidate')
            webRtcPeer.addIceCandidate(candidate).catch(err => {
                console.error('ERROR: ' + err.name);
            });
            break;

        case 'sdpAnswer':
            console.log('SDP answer received, processing..');
            webRtcPeer.setRemoteDescription({ type: 'answer', sdp: sdpAnswer });
            break;

        default:
            console.error('Unrecongnized message');
            break;
    }
}

//
// when a local ice candidate is generated
//
function onIceCandidate(event) {
    let candidate = event.candidate,
        message;

    console.log(`local candidate: ${JSON.stringify(candidate)}`);

    if (candidate == null) {
        console.log('null candidate');
        return;
    }
    message = {
        id: 'iceCandidate',
        candidate: candidate
    }
    // send ice candidate to remote peer
    ws.send(JSON.stringify(message));
}

//
// when a sdp offer is created, send the offer to the server
//
async function onLocalOfferCreated(err, sdpOffer) {
    let message;
    if (err) {
        console.error(err);
    }

    //
    // remove all other rtp profiles and request only h264 
    //
    // let split = sdpOffer.sdp.split('a=rtpmap:96 VP8/90000');
    // var h264Sdp = split[0] + "a=rtpmap:96 H264/90000\n";
    // sdpOffer.sdp = h264Sdp;

    await webRtcPeer.setLocalDescription(sdpOffer);

    message = {
        id: 'start',
        sdpOffer: sdpOffer.sdp
    }

    console.log('sending local sdp offer to remote peer');
    ws.send(JSON.stringify(message));
}

//
// On start button click
//
async function btnStart() {
    let stunAddr = {
        url: "stun.l.google.com:19302"
    },
        iceServers = [stunAddr],
        offer;

    console.log('Creating WebRtcPeer and generating local sdp offer ...');

    webRtcPeer = new RTCPeerConnection(iceServers); //  interface represents a WebRTC connection between the local computer and a remote peer

    webRtcPeer.onicecandidate = onIceCandidate;
    webRtcPeer.onopen = () => console.log('real time connection has established');
    webRtcPeer.onerror = (err) => console.log(`real time connection error ${err}`);
    webRtcPeer.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    }
    try {
        offer = await webRtcPeer.createOffer({ offerToReceiveAudio: 0, offerToReceiveVideo: 1 });
        onLocalOfferCreated(null, offer);
    } catch (err) {
        onLocalOfferCreated(err, null);
    }
}
