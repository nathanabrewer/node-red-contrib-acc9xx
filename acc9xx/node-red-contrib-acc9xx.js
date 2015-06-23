
module.exports = function(RED) {

    "use strict";
    var cheerio = require("cheerio");
    var http = require("http");
    var fs = require('fs');
    var moment = require('moment');
    var querystring = require('querystring');

    // The main node definition - most things happen in here
    function acc9xxNode(config) {
        // Create a RED node
        RED.nodes.createNode(this,config);

        // Store local copies of the node configuration (as defined in the .html)
        this.topic = config.topic;
        var node = this;
        var msg = {};

        //Loading and Tracking previously handled Indexes for this device, if any
        var HandledIndexesFilename = '/tmp/'+config.ip+'.json';
        fs.readFile(HandledIndexesFilename, 'utf8', function (err, data) {
          if (err){
            node.HandledIndexes = ['Index'];
          }
            try {
                node.HandledIndexes = JSON.parse(data);
            }catch(ex){
                node.HandledIndexes = ['Index'];    
            }
        });


        var intervalTime = parseInt(config.pollingtime);
        node.alarmcount = 0;

        function pollingLoop(){
            
            var request = http.request({host:config.ip, path:'EventLog.htm', auth: config.username+':'+config.password }, function (response) {
                 var buffer = '';
                 response.setEncoding('utf8');
                 response.on('data', function (chunk) { buffer += chunk; });
                 response.on('end', function() {
                    var $ = cheerio.load(buffer);
                    node.alarmcount = 0;

                    var events = [];

                    $('table:last-child tr').each(function(i, element){
                        var children = $(this).children();
                        var index = children.eq(0).text().trim();

                        if(node.HandledIndexes.indexOf(index) !== -1)
                            return;

                        var d = children.eq(1).text().trim().split("'");
                        var date = d[1]+'/'+d[0];
                        var time = children.eq(2).text().trim();
                        var address = children.eq(3).text().trim();
                        var display = children.eq(4).text().trim();
                        var detail = children.eq(5).text().trim().replace("(","").split(")");
                        var resultcode = detail[0];
                        var description = detail[1];
                        var datetime = Date.parse(date+ " "+time);
                        var secondsago = ((new Date() - datetime)/1000);
                        var cardUID = children.eq(6).text().trim();
                        var door = children.eq(7).text().trim();
                        events.push({
                            index: index,
                            date: date,
                            time: time,
                            door: door,
                            resultcode: resultcode,
                            description: description,
                            cardUID: cardUID,
                            datetime: datetime, 
                            secondsago: secondsago
                        });
                        //track that we have handled this index
                        node.HandledIndexes.push(index);
                      
                    });

                    handleNewEvents(events);

                  });
            }); 
            
            request.setTimeout(intervalTime, function(){
                
                node.alarmcount++;
                if(node.alarmcount < 10){
                    node.status({fill:"yellow",shape:"ring",text:"Communication Error - "+node.alarmcount});
                }else{
                    node.status({fill:"red",shape:"ring",text:"OFFLINE - ALARM STATE"});
                    msg = {alarm:"ALARM"};
                    node.send([null, null, null, msg]);
                }
            });
            request.on('error', function(error) {
                console.log('Request Error', error);
            });
            request.end();           
        }

        function handleNewEvents(events){

            if(events.length == 0){

                if(node.alarmState){
                    node.status({fill:"red",shape:"dot",text:"Forced Entry Alarm Door "+node.alarmState.door});
                }else{
                    var text = "Ready.";
                    if(typeof node.lastevent_time !== 'undefined'){
                        text = text+ " Last "+node.lastevent_type+" Event "+ moment(node.lastevent_time).fromNow();
                    }
                    node.status({fill:"green",shape:"ring",text:text});
                }
                return;
            }

            events.forEach(function(event){
                switch(event.resultcode){
                    case 'M01': //Invalid Code
                        node.status({fill:"red",shape:"dot",text:"Invalid Code"});
                        node.lastevent_time = event.datetime;
                        node.lastevent_type = "Invalid Code";
                        node.send([null, event, null, null]);

                    break;
                    case 'M03': //Invalid Card
                        node.status({fill:"red",shape:"dot",text:"Invalid Card"});
                        node.lastevent_time = event.datetime;
                        node.lastevent_type = "Invalid Card";
                        node.send([null, event, null, null]);
                    break;
                    case 'M11': //Normal Access
                        node.status({fill:"blue",shape:"dot",text:"Access Granted"});
                        node.lastevent_time = event.datetime;
                        node.lastevent_type = "Access";
                        node.alarmState = false;
                        node.send([event, null, null, null]);
                    break;

                    
                    case 'M16': //Egress
                        node.status({fill:"yellow",shape:"dot",text:"Egress"});
                        node.lastevent_time = event.datetime;
                        node.lastevent_type = "Egress";                    
                        node.send([event, null, null, null]);
                    break;

                    case 'M17': //Egress
                        node.status({fill:"red",shape:"dot",text:"Forced Entry Alarm"});
                        node.lastevent_time = event.datetime;
                        node.lastevent_type = "Forced Entry Alarm";                    
                        node.alarmState = event;
                        node.send([null, null, null, event]);
                    break;                    

                    case 'M24': //Power On
                        node.status({fill:"blue",shape:"dot",text:"Power On"});
                        node.lastevent_time = event.datetime;
                        node.lastevent_type = "Power On";    
                        node.alarmState = false;                
                        node.send([null, null, event, null]);
                    break;

                    default:
                        console.log("Unknown Log Event", event);
                    break;
                }

            });



            saveIndexes();
        }

        function saveIndexes(){
            //Storing previously handled Indexes for this device
            fs.writeFile(HandledIndexesFilename, JSON.stringify(node.HandledIndexes, null, 4), function(err) {
                if(err) {
                  console.log(err);
                } else {
                  console.log("Saving handled index stack: " + HandledIndexesFilename);
                }
            });             
        }

        function handleACC9XXPostData(path, post_fields, callback){

            var postData = querystring.stringify(post_fields);

            var req = http.request(
                {
                    host:config.ip, 
                    path:path, 
                    auth: config.username+':'+config.password, 
                    method:'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': postData.length
                    } 
                }, 
                function (response) {
                    var buffer = '';
                    response.setEncoding('utf8');
                    response.on('data', function (chunk) { buffer += chunk; });
                    response.on('end', function() {
                        callback(buffer);
                    });
                }
            ); 
            
            req.setTimeout(10000, function(error){
                console.log('Timeout Error', error);
            });

            req.on('error', function(error) {
                console.log('Request Error', error);
            });

            req.write(postData);

            req.end();        
           
        }

        function handleACC9XXMomentaryOpen(msg){
            var post_fields = {
                'doorOpen':'Pulse (Auto Close)',
                'btnOpenDoor':'Active',  
            };
            handleACC9XXPostData('CtrlParam.cgi', post_fields, function(data){
                //var $ = cheerio.load(data);
                node.warn("Momentary Open Activated");
            });
        }

        function handleACC9XXMomentaryOpenWG(msg){
            var post_fields = {
                'doorOpenWG':'Pulse (Auto Close)',
                'btnOpenDoorWG':'Active',  
            };
            handleACC9XXPostData('CtrlParam.cgi', post_fields, function(data){
                //var $ = cheerio.load(data);
                node.warn("Momentary Open Activated");
            });
        }
        function handleACC9XXUpdateClock(msg){
            
            var d = new Date();

            var post_fields = {
                clkYear: d.getFullYear()-2000,
                clkMon: d.getMonth()+1,
                clkDay: d.getDate(),
                clkHour: d.getHours(),
                clkMin: d.getMinutes(),
                clkSec: d.getSeconds()
            };
            console.log(post_fields);

            handleACC9XXPostData('SetClock.cgi', post_fields, function(data){
                //var $ = cheerio.load(data);
                node.warn("Updating Clock "+node.id);
            });
        }        

        function handleACC9XXUnlock(msg){
            //TODO    
        }

        function handleACC9XXConfigUser(msg){
            
            if(typeof msg.card !== 'undefined'){
                var card = msg.card.split(":");
                msg.uUIDsite = card[0];
                msg.uUIDcard = card[1];
            }

            var post_fields = {
                'uAddr': (typeof msg.uAddr !== 'undefined') ? msg.uAddr : '0',
                'uName': (typeof msg.uName !== 'undefined') ? msg.uName : 'No',
                'uMode': (typeof msg.uMode !== 'undefined') ? msg.uMode : 'Card Only',
                'uPIN':  (typeof msg.uPIN  !== 'undefined') ? msg.uPIN  : '0',
                'uUIDsite': (typeof msg.uUIDsite  !== 'undefined') ? msg.uUIDsite  : '',
                'uUIDcard': (typeof msg.uUIDcard  !== 'undefined') ? msg.uUIDcard  : '',
                'cGate0': (typeof msg.cGate0 !== 'undefined') ? msg.cGate0 : 'on',
                'uZone0': (typeof msg.uZone0 !== 'undefined') ? msg.uZone0 : '0',
                'cGate1': (typeof msg.cGate1 !== 'undefined') ? msg.cGate1 : 'on',
                'uZone1': (typeof msg.uZone1 !== 'undefined') ? msg.uZone1 : '0',
                'uLevel': (typeof msg.uLevel !== 'undefined') ? msg.uLevel : '0',
                'uDayBegin': (typeof msg.uDayBegin !== 'undefined') ? msg.uDayBegin : '00-01-01',
                'uDayEnd': (typeof msg.uDayEnd !== 'undefined') ? msg.uDayEnd : '99-12-31'    
            };

            handleACC9XXPostData('UserParam.cgi', post_fields, function(data){
                //var $ = cheerio.load(data);
                node.warn("Momentary Open Activated");
            });
        }

        if(typeof config.username === 'undefined' || config.password === 'undefined')
            return node.warn("Missing username/password? Aborting acc9xx registration of input handling.");

        if(config.enablepolling)
            var pollingInterval = setInterval(pollingLoop, intervalTime);


        //Actual Input
        this.on('input', function (msg) {

            switch(msg.topic){
                
                case 'momentary-open':
                    handleACC9XXMomentaryOpen(msg);
                break;

                case 'momentary-open-wg':
                    handleACC9XXMomentaryOpenWG(msg);
                break;

                case 'unlock':
                    handleACC9XXUnlock(msg);
                break;

                case 'config-user':
                    handleACC9XXConfigUser(msg);
                break;
                
                case 'update-clock':
                    handleACC9XXUpdateClock(msg);
                break;

                default:
                    node.warn("Unknown Input Action - payload: "+msg.payload);
                break;
            }
        });

        this.on("close", function() {            
            if(typeof pollingInterval !== 'undefined')
                clearInterval(pollingInterval);            
        });

       
    }


    
    RED.nodes.registerType("acc9xx",acc9xxNode);

}
