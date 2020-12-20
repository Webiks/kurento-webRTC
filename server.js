const express = require('express'),
    session = require('express-session'),
    ws = require('ws'),
    KurentoClient = require('./Kurento/KurentoClient');

const KURENTO_WS_URL = 'ws://localhost:8888/kurento'; // Kurento url, if the kurento is running in other machine then replace localhost with the machine's IP.


// Express

let app = express(),
    sessionHandler = new session({
        secret: 'none',
        rolling: true,
        resave: true,
        saveUninitialized: true
    });

app.use(sessionHandler);

// Static
app.use(express.static('client'));

app.listen(3000, function () {
    console.log('listenning at 3000');
});

//
// Web Socket
// 
let wss = new ws.Server({
    port: 8080,
});

wss.on('connection', (newSocket, req) => {
    var sessionId,
        request = req,
        response = {
            writeHead: {}
        };

    sessionHandler(request, response, function (err) {
        sessionId = request.sessionID;
        console.log('Connection received with sessionId ' + sessionId);
    });

    // sessionHandler(request, response).catch(err => {
    //     console.log(err);
    // });
    sessionId = request.sessionID;
    console.log('Connection received with sessionId ' + sessionId);
    // create a new KurentoClient for each client
    let kClient = new KurentoClient(KURENTO_WS_URL, newSocket);

    newSocket.on('open', () => {
        console.log(`connected to ${req.connection.remoteAddress}`);
    });

    newSocket.on('close', () => {
        console.log('disconnected');
        kClient.destroyPipeline(sessionId);
    });

    newSocket.on('error', (err) => {
        console.log(err);
        kClient.destroyPipeline(sessionId);
    });

    //
    // Message
    //
    newSocket.on('message', function onMessage(msg) {
        let parsedMsg = JSON.parse(msg);

        switch (parsedMsg.id) {
            case 'start':
                console.log('received "start" message ');

                kClient.createPipeline(sessionId, parsedMsg.sdpOffer, function (err, sdpAnswer) {
                    let response;
                    if (err) {
                        console.error(err);

                        response = JSON.stringify({
                            id: 'error',
                            message: err
                        });
                    }
                    else {
                        if (parsedMsg.sdpOffer != null) {
                            response = JSON.stringify({
                                id: 'sdpAnswer',
                                sdpAnswer: sdpAnswer
                            });
                        }
                        else {
                            console.log('f');
                            response = JSON.stringify({});
                        }
                    }

                    return newSocket.send(response);
                });
                break;
            case 'stop':
                kClient.destroyPipeline(sessionId);
                break;

            case 'iceCandidate':
                console.log('received ice candidate');

                kClient.addClientIceCandidate(sessionId, parsedMsg.candidate);
                break;

            default:
                newSocket.send(JSON.stringify({
                    id: 'error',
                    message: 'Invalid message '
                }));
                break;
        }
    });
});
