'use strict';

console.log('Loading function...');
console.log('Loading dependencies...');
const functions = require('firebase-functions');
const admin = require("firebase-admin");
const cors = require('cors')({origin: true});
const axios = require('axios');
const _ = require('lodash');
const serviceAccount = require('./info.json');

exports.botcast = functions.https.onRequest((req, res) => {

    if (req.method !== 'POST') {
        res.status(403).send('Forbidden!');
        return;
    }

    cors(req, res, () =>
    {
        return main(req, res);
    });
});

function main(req, res){

    //Check for pnut token.
    console.log('Retrieving token...');
    if(!req.body.token){
        res.status(403).send('Forbidden!  No token sent.');
        return;
    }

    //Check for show.
    console.log('Retrieving show...');
    if(!req.body.show.trim()){
        res.status(403).send('Forbidden!  No show sent.');
        return;
    }

    console.log('Retrieving message...');
    if(!req.body.message.trim()){
        res.status(403).send('Forbidden!  No message sent.');
        return;
    }

    console.log('Configuring Firebase...');
    let app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: functions.config().mndp.database_url
    });
    let fb = admin.database();

    return validatePnutToken(req.body.token)
        .then(user => processUser(user, req.body.show, fb))
        .then(userDetails =>
        {
            if(!userDetails.isDj){
                res.status(401).send('User is not DJ for show!  No message sent.');
                return app.delete();
            }
            console.log('Sending message...');

            return postMessage(req.body.message, req.body.reply_to, 600);
        })
        .then(() =>
        {
            let result = 'Message "' + req.body.message + '" sent!';

            res.status(200).send(result);
            return app.delete();
        })
        .catch(error =>
        {
            console.log(error);

            let message = error.message ? error.message : 'Error!';
            let code = error.returnCode ? error.returnCode : 500;
            res.status(code).send(message);
            return app.delete();
        });
}

function validatePnutToken(token){
    console.log('Validating token...');
    console.log('Initializing axios...');
    axios.defaults.baseURL = 'https://api.pnut.io';
    let config = {
        headers: {'Authorization': 'Bearer ' + token }
    };

    console.log('Getting user data...');
    return axios.get('/v0/users/me', config)
        .then(function (response)
        {
            if(response.data.meta.code !== 200){
                console.log('Error validating token...');
                throw {
                    message: response.data.meta.error_message
                    , returnCode: response.data.meta.code
                };
            }

            return response.data.data;
        });
}

function processUser(user, show, fb){
    console.log('Processing user ' + user.username + '...');

    //Check if user is DJ of show.
    console.log('Show found.  Checking if user is valid DJ for ' + show + '...');

    let djsRef = fb.ref('shows/djs/' + show);

    return djsRef.once('value').then(snapshot =>
    {
        let isDj = false;

        console.log('Retrieved DJ\'s list...');

        snapshot.forEach(x =>
        {
            console.log(x.val());

            isDj = x.val() === user.username;

            if(isDj)
                return true;
        });

        if(isDj){
            console.log(user.username + ' is DJ for ' + show + '...');
            return {
                user: user,
                isDj: true
            };
        }

        return { user: user };
    });
}

function postMessage(text, replyTo, channelId){
    if(!_.isFinite(channelId))
        throw 'Invalid channelId "' + channelId + '"!';

    let message = { text: text };
    let config = {
        params: {
            update_marker: 1
            , include_raw: 1
        },
        headers: {'Authorization': 'Bearer ' + functions.config().mndp_botcast.botcast_key }
    };

    if(_.isString(replyTo) && !_.isEmpty(_.trim(replyTo)))
        message.reply_to = replyTo;

    return axios.post('/v0/channels/' + channelId + '/messages', message, config);
}
