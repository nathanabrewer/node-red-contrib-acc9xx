
module.exports = function(RED) {

    "use strict";
    var os = require('os');
    //var webdriverio = require('webdriverio');
    var cheerio = require("cheerio");
    var http = require("http");
    var fs = require('fs');
    var moment = require('moment');

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

        var ops = {'host':config.ip, 'auth': config.username+':'+config.password };
        node.alarmcount = 0;
        function pollingLoop(){
            ops.path="EventLog.htm";    
            var request = http.request(ops, function (response) {
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
                console.log("ALARM STATE");
                node.alarmcount++;
                if(node.alarmcount < 10){
                    node.status({fill:"yellow",shape:"ring",text:"Alarm State - "+node.alarmcount});
                }else{
                    node.status({fill:"red",shape:"ring",text:"OFFLINE - ALARM STATE"});
                    msg = {alarm:"ALARM"};
                    node.send([null, null, null, msg]);
                }
            });
            
            request.end();           
        }

        function handleNewEvents(events){

            if(events.length == 0){

                var text = "Ready.";

                if(typeof node.lastevent_time !== 'undefined'){
                    text = text+ " Last "+node.lastevent_type+" Event "+ moment(node.lastevent_time).fromNow();
                }

                node.status({fill:"green",shape:"ring",text:text});

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
                        node.send([event, null, null, null]);
                    break;

                    
                    case 'M16': //Egress
                        node.status({fill:"yellow",shape:"dot",text:"Egress"});
                        node.lastevent_time = event.datetime;
                        node.lastevent_type = "Egress";                    
                        node.send([event, null, null, null]);
                    break;

                    case 'M24': //Power On
                        node.status({fill:"blue",shape:"dot",text:"Power On"});
                        node.lastevent_time = event.datetime;
                        node.lastevent_type = "Power On";                    
                        node.send([null, null, event, null]);
                    break;

                    default:
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


        if(config.enablepolling)
            var pollingInterval = setInterval(pollingLoop, intervalTime);



        this.on('input', function (msg) {

            node.warn("I saw a payload: "+msg.payload);

            if(typeof msg.username === 'undefined' || msg.password === 'undefined')
                return node.warn("Missing username/password?");

            // webdriverio
            //     .remote({
            //         desiredCapabilities: {
            //             browserName: 'firefox'
            //         }
            //     })
            //     .init()
            //     .url(msg.payload)
            //     .setValue('input[name=email]', msg.username)
            //     .setValue('input[name=password]', msg.password)
            //     .doubleClick("form input.btn.btn-red.pull-right", function(err,res){
            //         console.log(err,res);
            //     })
            //     .title(function(err, res) {
            //         //console.log('Title was: ' + res.value);
                    
            //         msg.payload = res.value;
            //         node.send([msg,1,2,3,4]);
            //     })
            //     .end();

        });

        this.on("close", function() {
            
            if(typeof pollingInterval !== 'undefined')
                clearInterval(pollingInterval);            
            
            // Called when the node is shutdown - eg on redeploy.
            // eg: node.client.disconnect();
        });

       
    }
    
    RED.nodes.registerType("acc9xx",acc9xxNode);

}
