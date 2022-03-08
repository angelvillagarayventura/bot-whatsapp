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

var serviceAccount = require("./alimentacion-beta-firebase-adminsdk-s7obu-c99ae1e58f.json");


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});





const db = admin.firestore();

date = new Date();
fecha_actual = String(date.getDate()).padStart(2, '0') + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + date.getFullYear();




const query = db.collection('Reservaciones/' + fecha_actual + "/almuerzo")

client.on('ready',() =>{
    query.onSnapshot(querySnapshot => {
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

