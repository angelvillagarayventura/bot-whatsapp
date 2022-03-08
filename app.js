/**
 * ⚡⚡⚡ DECLARAMOS LAS LIBRERIAS y CONSTANTES A USAR! ⚡⚡⚡
 */
 require('dotenv').config()
 const fs = require('fs');
 const express = require('express');
 const cors = require('cors')
 const qrcode = require('qrcode-terminal');
 const { Client, LegacySessionAuth } = require('whatsapp-web.js');
 const mysqlConnection = require('./config/mysql')
 const { middlewareClient } = require('./middleware/client')
 const { generateImage, cleanNumber } = require('./controllers/handle')
 const { connectionReady, connectionLost } = require('./controllers/connection')
 const { saveMedia } = require('./controllers/save')
 const { getMessages, responseMessages, bothResponse } = require('./controllers/flows')
 const { sendMedia, sendMessage, lastTrigger, sendMessageButton, readChat, sendMediaVoiceNote } = require('./controllers/send')
 const app = express();
 app.use(cors())
 app.use(express.json())
 
 const server = require('http').Server(app)
 const io = require('socket.io')(server, {
     cors: {
         origins: ['http://localhost:4200']
     }
 })
 
 let socketEvents = {sendQR:() => {} ,sendStatus:() => {}};
 
 io.on('connection', (socket) => {
     const CHANNEL = 'main-channel';
     socket.join(CHANNEL);
     socketEvents = require('./controllers/socket')(socket)
     console.log('Se conecto')
 })
 
 app.use('/', require('./routes/web'))
 
 const port = process.env.PORT || 3000
 const SESSION_FILE_PATH = './session.json';
 var client;
 var sessionData;
 
 /**
  * Escuchamos cuando entre un mensaje
  */
 const listenMessage = () => client.on('message', async msg => {
     const { from, body, hasMedia } = msg;
     // Este bug lo reporto Lucas Aldeco Brescia para evitar que se publiquen estados
     if (from === 'status@broadcast') {
         return
     }
     message = body.toLowerCase();
     console.log('BODY',message)
     const number = cleanNumber(from)
     await readChat(number, message)
 
     /**
      * Guardamos el archivo multimedia que envia
      */
     if (process.env.SAVE_MEDIA && hasMedia) {
         const media = await msg.downloadMedia();
         saveMedia(media);
     }
 
     /**
      * Si estas usando dialogflow solo manejamos una funcion todo es IA
      */
 
     if (process.env.DATABASE === 'dialogflow') {
         const response = await bothResponse(message);
         await sendMessage(client, from, response.replyMessage);
         if (response.media) {
             sendMedia(client, from, response.media);
         }
         return
     }
 
     /**
     * Ver si viene de un paso anterior
     * Aqui podemos ir agregando más pasos
     * a tu gusto!
     */
 
     const lastStep = await lastTrigger(from) || null;
     console.log({ lastStep })
     if (lastStep) {
         const response = await responseMessages(lastStep)
         await sendMessage(client, from, response.replyMessage);
     }
 
     /**
      * Respondemos al primero paso si encuentra palabras clave
      */
     const step = await getMessages(message);
     console.log({ step })
 
     if (step) {
         const response = await responseMessages(step);
 
         /**
          * Si quieres enviar botones
          */
 
         await sendMessage(client, from, response.replyMessage, response.trigger);
         if(response.hasOwnProperty('actions')){
             const { actions } = response;
             await sendMessageButton(client, from, null, actions);
             return
         }
 
         if (!response.delay && response.media) {
             sendMedia(client, from, response.media);
         }
         if (response.delay && response.media) {
             setTimeout(() => {
                 sendMedia(client, from, response.media);
             }, response.delay)
         }
         return
     }
 
     //Si quieres tener un mensaje por defecto
     if (process.env.DEFAULT_MESSAGE === 'true') {
         const response = await responseMessages('DEFAULT')
         await sendMessage(client, from, response.replyMessage, response.trigger);
 
         /**
          * Si quieres enviar botones
          */
         if(response.hasOwnProperty('actions')){
             const { actions } = response;
             await sendMessageButton(client, from, null, actions);
         }
         return
     }
 });
 
 /**
  * Revisamos si tenemos credenciales guardadas para inciar sessio
  * este paso evita volver a escanear el QRCODE
  */
 const withSession = () => {
     // Si exsite cargamos el archivo con las credenciales
     console.log(`Validando session con Whatsapp...`)
     sessionData = require(SESSION_FILE_PATH);
     client = new Client({
         authStrategy: new LegacySessionAuth({
             session: sessionData // saved session object
         }),
         restartOnAuthFail: true,
         puppeteer: {
             args: [
                 '--no-sandbox'
             ],
         }
     });
 
     client.on('ready', () => {
         connectionReady()
         listenMessage()
         loadRoutes(client);
         socketEvents.sendStatus()
     });
 
     client.on('auth_failure', () => connectionLost())
 
     client.initialize();
 }
 
 /**
  * Generamos un QRCODE para iniciar sesion
  */
 const withOutSession = () => {
     console.log('No tenemos session guardada');
     console.log([
         '🙌 El core de whatsapp se esta actualizando */*/*/*/*/**/* 555559797 979 77 9 222222',
         '🙌 para proximamente dar paso al multi-device',
         '🙌 falta poco si quieres estar al pendiente unete',
         '🙌 http://t.me/leifermendez',
         '________________________',
     ].join('\n'));
 
     client = new Client({
         session: { },
         // authStrategy: new LegacySessionAuth({
         //     session: { }
         // }),
         restartOnAuthFail: true,
         puppeteer: {
             args: [
                 '--no-sandbox'
             ],
         }
     });
 
     client.on('qr', qr => generateImage(qr, () => {
         qrcode.generate(qr, { small: true });
         console.log(`Ver QR http://localhost:${port}/qr`)
         socketEvents.sendQR(qr)
     }))
 
     client.on('ready', (a) => {
         connectionReady()
         listenMessage()
         loadRoutes(client);
         // socketEvents.sendStatus(client)
     });
 
     client.on('auth_failure', (e) => {
         // console.log(e)
         // connectionLost()
     });
 
     client.on('authenticated', (session) => {
         sessionData = session;
         fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
             if (err) {
                 console.log(`Ocurrio un error con el archivo: `, err);
             }
         });
     });
 
     client.initialize();
 }
 
 /**
  * Cargamos rutas de express
  */
 
 const loadRoutes = (client) => {
     app.use('/api/', middlewareClient(client), require('./routes/api'))
 }
 /**
  * Revisamos si existe archivo con credenciales!
  */
 (fs.existsSync(SESSION_FILE_PATH)) ? withSession() : withOutSession();
 
 /**
  * Verificamos si tienes un gesto de db
  */
 
 if (process.env.DATABASE === 'mysql') {
     mysqlConnection.connect()
 }
 
 server.listen(port, () => {
     console.log(`El server esta listo por el puerto ${port}`);
 })
 
 
 
 
 
 
 
 const country_code = "51";
 
 
 var admin = require("firebase-admin");
 
 var serviceAccount = {
   "type": "service_account",
   "project_id": "alimentacion-beta",
   "private_key_id": "c99ae1e58f7220381e04bdb0a76e2d9041c53a9e",
   "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC2mL0ReH1vzWC5\nwMlKHbWGQIfLc6uxvZMQ8j1jJf7d8ZpL4LHtHSkM7BxkBxHIRffGQDWPAiNzvviJ\nnBtV+QsMHPYdFtsu20WZjUWX4oxGC+HkFzKlkRctjSYKMDBYP78imu6aVhsuk3Zq\njs07K/WY26/5yJmM/jCdve450u9n6fNHG018hr44zojHl+tWu/Ple8EEKDy3G/t5\n9lHSmNLyake6yZFZtL5KeLmLqlD4XNBiKFXCt7txclCFsLOYL7FqqAgDGaWbqRjd\nIpYKmbauul2efoklHJGRjr5ZUbUyvRvbgzFSurrrw9hTA4dmDhKZvXgFAagfrZpA\nDeZDglmHAgMBAAECggEAAarzU0lzj2gocq1x9RKHp3m+FF9Yigtu7pe6ybw7Lpna\nQMiAY2MBwq7mSuR8c9WKb1+3zOxK91gMKDUESpriBFsfERhb1HFctu9wgUmHed+R\nwzabnyZ6Z37Y14HLsG6C2KIkv3lQh9+PmRqZGUi9ueWx3IWHa5Xi7Dwjy+3tzwww\nhllOJvzlwPvScKmMuz2Y5xc+rdeGo3Lrdr0nFXj/hcVs9XCEfJYmyLjuws/H5Puo\nNuWAP9EvZIp+9b2RNL/po7mfr43a5SxysTacrxo4iliG0/RbM6QnfHpY9I3yoX03\nWzDTGopc/BWVthL4+xr9TRQFDJrcHe/m/s+iQkHuYQKBgQD1PJpI4f/AP+uj/Vjg\ntf7qbtS0imrbVpGdC79cj1OoKxzUWx3Th18Jgb+hHVOvXG7vLLagGuRlTUwXcXUx\nBVE1vnLys/X380QvRJYVSLe4DSMtLtFbldXnm6e3s+pl34dzZlCbobz+bh6QnP9L\nsLvcZtst+6b/XQVf7h1x4jIXeQKBgQC+nFU2iA2Ijm9ykbwd9nLYovjZEg+atiL9\nQgMMV8uBSEZsKTdqSVWQQ6okW1Ily/ToQhxh7w+EOZSVzFEfUFbjSsKf6LHqhGb/\nUHWUVJ0+ursmaO3hHmSoO6LfdAqNj+i6TyskE3Tc/g0uMlmqG9kOCD/AeLbCRRKG\nVI2R0y64/wKBgCtq/lnXAWO1LXAMQ7cNIcO5uZj5RK/upLssQEYP7hzA/UqvkxlH\nR1E0kovg2Fccw1s/DFpOSI+S3tzrrnbuXRFp1YoYyHyMqk7AEt5T0IsacFboihJv\n9b4atdf1V5OPvrh0reLQANj/ABRUZ3KsKKZ942JBwrBFdNUmIDpwdLPpAoGAQwrj\nofGKqQxIQMjnnLZRQMdZtaf3mxgTCHcOcWnz5z4Pnv2EQzsWAE78ahtAspChTIvs\nRbn7ACvsih+6LMRqOznRaMNEyNLXE1gucwSr5iNxrhncCYFSMCYBrIy5JX+HgPhV\nmTPKt+wXoLcO+Jkg6CGYos8SoRQAZwUYYkEgPusCgYEA6znI66cOCXVX5E3Rx+xL\nSN8cgGPYERJNP5XXxvWdpi081r7Kudv3caARaId9i9p0sjSmF03JdLdZ5yFl7M/A\nENvLaHBh80FjAtOHTniYqgmV8uYGkjz+VL3uR1yeS3viOv1z+Fr7rB94LDVPVHCL\nZ89Il3NC/hK8eSfGfY0TSe8=\n-----END PRIVATE KEY-----\n",
   "client_email": "firebase-adminsdk-s7obu@alimentacion-beta.iam.gserviceaccount.com",
   "client_id": "114509375932502198875",
   "auth_uri": "https://accounts.google.com/o/oauth2/auth",
   "token_uri": "https://oauth2.googleapis.com/token",
   "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
   "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-s7obu%40alimentacion-beta.iam.gserviceaccount.com"
 };
 
 
 admin.initializeApp({
   credential: admin.credential.cert(serviceAccount)
 });
 
 
 
 
 
 const db = admin.firestore();
 
 
 date = new Date();
 fecha_actual = String(date.getDate()).padStart(2, '0') + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + date.getFullYear();

 
 const query = db.collection('Reservaciones/' + fecha_actual + "/almuerzo")
 
 client.on('ready',() =>{
     query.onSnapshot(querySnapshot => {
         
       
         console.log("tal vez si")
         console.log(querySnapshot.docChanges())
         querySnapshot.docChanges().forEach(change => {
           if (change.type === 'added') {
             reservar_almuerzo(change.doc.data())
             
           }
           if (change.type === 'modified') {
            
           }
           if (change.type === 'removed') {
             cancelar_reservacion(change.doc.data())
           
           }
         });
       });
 })
 
 
 
  var array_espera = [];
   var array_espera_2 = [];
 
   
   function reservar_almuerzo(trabajador)
   {
     array_espera_2.push(trabajador);
         
         setTimeout( function () {
 
             var mensaje = '✔️ Buenos dias ' + array_espera_2[0].any.any.nombres_apellidos +  ' se acaba de reservar un almuerzo a su nombre ✔️'
             let chatID = country_code + array_espera_2[0].any.any.numero_telf + "@c.us"
 
             client.sendMessage(chatID,mensaje)
                     .then(response =>{
                         if (response.id.fromMe) {
                            
                         }
                     })
                     
                     var newArray = array_espera_2.filter((item) => item.any.any.dni  !== array_espera_2[0].any.any.dni );
                     array_espera_2 = newArray
                    
                 }
             
             ,30000);
   }
 
 
 
   function cancelar_reservacion(trabajador)
   {
     array_espera.push(trabajador);
         
         setTimeout( function () {
             var mensaje = '❌ Buenos dias ' + array_espera[0].any.any.nombres_apellidos +  'se acaba de cancelar su reservacion  ❌' 
 
             let chatID = country_code + array_espera[0].any.any.numero_telf + "@c.us";
 
             client.sendMessage(chatID,mensaje)
                     .then(response =>{
                         if (response.id.fromMe) {
                           
                         }
                     }) 
                 
                     var newArray = array_espera.filter((item) => item.any.any.dni  !== array_espera[0].any.any.dni );
                     array_espera = newArray
                   
                 }
             ,30000);   
   }
 
 
