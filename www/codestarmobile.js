/* modified by bcc <bcc@isans.co.kr>, Nov 2016 */

new (function() {
    var ext = this;
    var device = null;
    var alarm_went_off = false; // This becomes true after the alarm goes off
    var result = {0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0};
    var hl = {high:1, low:0};
    var tones = {G3:196,A3:220,B3:247,C4:262,D4:294,E4:330,F4:349,G4:392,A4:440,B4:494,C5:523,D5:587,E5:659,F5:698};
    var dtype = {Whole:4,Half:2,Quarter:1,Eighth:0.5,Sixteenth:0.25};
    var axis = {x:0, y:1, z:2};
    var dn = {buzzer:'A3', remote:'D4'};
    var digital_ports = {D0:0,D1:1,D2:2,D3:3,D4:4,D5:5,D6:6,D7:7,D8:8,D9:9,D10:10,D11:11,D12:12,D13:13};
    var analog_ports = {A0:0,A1:1,A2:2,A3:3,A4:4,A5:5,A6:6,A7:7};
    var drive = {forward:0, backward:1, left:2, right:3};
    var wheel = {left:0, right:1};
    var deviceNumber = {sonar:1, button:2, variableR:3, mic:4, temp:5, motion:6, gyro:7, geom:8, touch:9, light:10,ir:11, tilt:12,
        color0:21, color3:22, buzzer:23, buzzerStop:24, servo:25, irR:26, vibration:27,wheel:28,drive:29, version:41, timer:42};
    // Cleanup function when the extension is unloaded
    ext._shutdown = function() {
        if(device) device.close();
        device = null;
    };

    // Status reporting code
    // Use this to report missing hardware, plugin or unsupported browser
    ext._getStatus = function() {
        if(!device) return {status: 1, msg: 'Arduino disconnected'};
        if(watchdog) return {status: 1, msg: 'Probing for Arduino'};
        return {status: 2, msg: 'Arduino connected'};
    };
    ext.set_alarm = function(time) {
        window.setTimeout(function() {
            alarm_went_off = true;
            if(device){
                var bytes = [];
                bytes.push(0xff);
                bytes.push(0x55);
                device.send(bytes);
            }
        }, time*1000);
    };

    ext.when_alarm = function() {
        // Reset alarm_went_off if it is true, and return true
        // otherwise, return false.
        if (alarm_went_off === true) {
            alarm_went_off = false;
            return true;
        }
        return false;
    };

    // Extension API interactions
    var potentialDevices = [];
    ext._deviceConnected = function(dev) {
        potentialDevices.push(dev);
        if (!device) {
            tryNextDevice();
        }
    };

    function tryNextDevice() {
        // If potentialDevices is empty, device will be undefined.
        // That will get us back here next time a device is connected.
        device = potentialDevices.shift();
        if (device) {
            device.open({ stopBits: 0, bitRate: 9600, ctsFlowControl: 0 }, deviceOpened);
        }
    }

    var watchdog = null;
    function deviceOpened(dev) {
        if (!dev) {
            // Opening the port failed.
            tryNextDevice();
            return;
        }
        device.set_receive_handler('SensorKitUSB',function(data) {
            processData(data);
        });
    }

    function resetPackDict(id){
        packDict[id] = false;
    }
    var packDict = [];
    /*
     ff 55 len idx action device port  slot  data a
     0  1  2   3   4      5      6     7     8
     */
    function runPackage(){
        var bytes = [];
        bytes.push(0xff);
        bytes.push(0x55);
        bytes.push(0);
        bytes.push(0);
        bytes.push(2);
        for(var i = 0; i < arguments.length; i++){
            if(arguments[i].constructor == "[class Array]"){ // if array
                bytes = bytes.concat(arguments[i]); // join
            }else{
                bytes.push(arguments[i]);
            }
        }

        bytes[2] = bytes.length-3;
        device.send(bytes);
        trace(bytes);
    }
    function getPackage(){
        var id = arguments[0];
        var bytes = [0xff, 0x55];
        bytes.push(arguments.length+1);
        bytes.push(id);
        bytes.push(1);  // GET protocol
        for(var i = 1; i < arguments.length; i++){
            bytes.push(arguments[i]);
        }
        device.send(bytes);
        trace(bytes);
    }

    var inputArray = [];
    var isStart = false;
    var parseIdx = 0;
    var rxBuf = [];
    function processData(bytes){
        var len = bytes.length;
        if(rxBuf.length > 30){
            rxBuf = [];    // reset
        }
        for(var idx = 0; idx < bytes.length; idx++){
            var c = bytes[idx];
            rxBuf.push(c);
            trace(c);
            if(rxBuf.length >= 2){  // header
                if(rxBuf[rxBuf.length-1] == 0x55 && rxBuf[rxBuf.length-2] == 0xff){
                    isStart = true;
                    parseIdx = rxBuf.length-2;
                }
                // LF, CR checking
                if(rxBuf[rxBuf.length-1] == 0xa && rxBuf[rxBuf.length-2] == 0xd && isStart){  // end
                    isStart = false;
                    var pos = parseIdx+2;
                    var device = rxBuf[pos];
                    pos++;

                    var type = rxBuf[pos];
                    pos++;
                    // 1 byte 2 float 3 short 4 len+string 5 double
                    var value;
                    switch (type) {
                        case 1:
                            value = rxBuf[pos];
                            pos++;
                            break;
                        case 2:
                            value = readShort(rxBuf, pos);
                            pos += 2;
                            break;
                        case 3:
                            value = readFloat(rxBuf, pos);
                            pos += 4;
                            if(value < -255 || value > 1023){
                                value = 0;
                            }
                            break;
                        case 4:
                            var l = rxBuf[pos];
                            pos++;
                            value = readString(rxBuf, pos, l);
                            break;
                        case 5:
                            value = readDouble(rxBuf, pos);
                            pos += 4;
                            break;
                    }

                    if(type <= 5){
                        result[device] = value;
                    }
                    rxBuf = [];

                }
            }
        }
    }
    function sleep(ms) {
        var unixtime_ms = new Date().getTime();
        while(new Date().getTime() < unixtime_ms + ms) {}
    }
    function readFloat(arr, position){
        var v = [arr[position], arr[position+1], arr[position+2], arr[position+3]];
        return parseFloat(v);
    }
    function readShort(arr, position){
        var v = [arr[position], arr[position+1]];
        return parseShort(v);
    }
    function readString(arr, position, len){
        var v = '';
        for(var i = 0; i < len; i++){
            v += String.fromCharCode(arr[i+position]);
        }
        return v;
    }
    function readDouble(arr, position){
        return readFloat(arr, position);
    }

    ext.runArduino = function(){
        for(var key in deviceNumber) {
            result[deviceNumber[key]] = 0;
        }
    };
    ext.cs_initialize = function () {
        for(var key in deviceNumber) {
            result[deviceNumber[key]] = 0;
        }
    };
    ext.cs_color_single = function(color, onoff, id){
        var ports = {red:7, blue:8};
        if(device){
            runPackage(deviceNumber['color0'], ports[color], hl[onoff]);
            trace(id);
        }
    };
    ext.cs_3color = function(color, value){
        var ports = {red:9, green:10, blue:11};
        var tmp = value;
        if(device){
            if(value < 0) tmp = 0;
            if(value > 255) tmp = 255;
            runPackage(deviceNumber['color3'], ports[color], tmp);
        }
    };
    ext.cs_vibration = function(port, onoff){
        if(device) {
            if (port === 'On-board') {
                port = 'D13';
            }
            runPackage(deviceNumber['vibration'], digital_ports[port], hl[onoff]);
        }
    };
    ext.cs_buzzer = function(code, duration){
        if(device){
            runPackage(deviceNumber['buzzer'], analog_ports[dn['buzzer']],
                short2array(tones[code]), dtype[duration]);
            sleep(dtype[duration]*500);
        }
    };
    ext.cs_buzzer_stop = function(){
        if(device){
            runPackage(deviceNumber['buzzerStop'], analog_ports[dn['buzzer']], 0);
        }
    };
    ext.cs_button = function(){
        if(device) {
            getPackage(0, deviceNumber['button'], digital_ports['D12']);
        }
        return result[2];
    };
    ext.cs_servo = function(port, value){
        if(device){
            runPackage(deviceNumber['servo'], digital_ports[port], value);
        }
    };
    ext.cs_variable_R = function(port){
        if(device) {
            getPackage(0, deviceNumber['variableR'], analog_ports[port]);// id(packet number),device,port
        }
        return result[deviceNumber['variableR']];
    };
    ext.cs_mic = function(port){
        if(device) {
            if (port === 'On-board') {
                port = 'A2';
            }
            getPackage(0, deviceNumber['mic'], analog_ports[port]);
        }
        return result[deviceNumber['mic']];
    };
    ext.cs_temperature = function(port){
        if(device) {
            if (port === 'On-board') {
                port = 'A7';
            }
            getPackage(0, deviceNumber['temp'], analog_ports[port]);
        }
        return result[deviceNumber['temp']];
    };
    ext.cs_motion_detect = function(port){
        if(device) {
            getPackage(0, deviceNumber['motion'], digital_ports[port]);
        }
        return result[deviceNumber['motion']];
    };
    ext.cs_gyroscope = function(port, pos){
        if(device) {
            getPackage(0, deviceNumber['gyro'], analog_ports[port], axis[pos]);
        }
        return result[deviceNumber['gyro']];
    };
    ext.cs_geomagnetic = function(port, pos) {
        if(device) {
            if (port === 'On-board') {
                port = 'A5'; // don't care
            }
            getPackage(0, deviceNumber['geom'], analog_ports[port], axis[pos]);
        }
        return result[deviceNumber['geom']];
    };
    ext.cs_touch = function(port){
        if(device) {
            getPackage(0, deviceNumber['touch'], digital_ports[port]);
        }
        return result[deviceNumber['touch']];
    };
    ext.cs_irR = function(port){
        if(device) {
            if (port === 'On-board') {
                port = 'D4';
            }
            getPackage(0, deviceNumber['irR'], digital_ports[port]);
        }
        return result[deviceNumber['irR']];
    };
    ext.cs_light_sensor = function(port){
        if(device) {
            if (port === 'On-board') {
                port = 'A6';
            }
            getPackage(0, deviceNumber['light'], analog_ports[port]);
        }
        return result[deviceNumber['light']]
    };

    ext.cs_drive = function(dir, velocity){
        if(device){
            runPackage(deviceNumber['drive'], 0, drive[dir], velocity);
            // device num, fixed port, param1, param2
        }
    };
    ext.cs_wheel = function(dir, velocity){
        if(device){
            runPackage(deviceNumber['wheel'], 0, wheel[dir], short2array(velocity));
            // device num, fixed port, param1, param2(short)
        }
    };
    ext.cs_sonar = function(){
        if(device){
            getPackage(0, deviceNumber['sonar'], 0);
            // id, device num, fixed port
        }
        return result[deviceNumber['sonar']];
    };
    ext.cs_ir = function(port){
        if(device){
            getPackage(0, deviceNumber['ir'], analog_ports[port]);
        }
        return result[deviceNumber['ir']];
    };

    ext.cs_joystick = function(xport, yport){

    };
    ext.cs_joybutton = function(port){

    };
    ext.cs_tilt = function(port){
        if(device) {
            getPackage(0, deviceNumber['tilt'], digital_ports[port]);
        }
        return result[deviceNumber['tilt']];
    };
    // output: RGB LED, LED 양쪽눈, 진동 모터, buzzer(do, re, me...);
    // input:button, light sensor, mic
    var descriptor = {
        blocks: [
            ['h', 'CodeStar Program','runArduino'],
            [' ', 'Initialize sensor', 'cs_initialize'],
            [' ', '%m.colorSingle LED %m.hl', 'cs_color_single', 'red', 'high'],
            [' ', 'set RGB LED %m.color LED %n', 'cs_3color', 'green', 100],
            [' ', 'vibration motor %m.vmPort %m.hl', 'cs_vibration', 'On-board', 'high'],
            [' ', 'buzzer tone %m.tone %m.player play', 'cs_buzzer', 'F4', 'Half'],
            [' ', 'buzzer stop', 'cs_buzzer_stop'],
            ['r', 'light sensor %m.lightPort', 'cs_light_sensor', 'On-board'],
            ['r', 'button [push:1, release:0]', 'cs_button'],
            [' ', 'set servo motor %m.servoPort %m.servoValue', 'cs_servo', 'D3', 90],
            ['r', 'variable resistance %m.analogPort', 'cs_variable_R', 'A0'],
            ['r', 'Mic %m.tmpMicPort', 'cs_mic', 'On-board'],
            ['r', 'temperature %m.tmpMicPort', 'cs_temperature', 'On-board'],
            //['r', 'detect motion %m.digitalPort', 'cs_motion_detect', 'D2'],
            ['r', 'axis gyroscope %m.gyroPort %m.axis axis', 'cs_gyroscope', 'A4', 'x'],
            ['r', 'axis geomagnetic %m.geoPort %m.axis axis', 'cs_geomagnetic', 'On-board', 'x'],
            ['r', 'touch %m.digitalPort', 'cs_touch', 'D3'],
            ['r', 'IR Remocon %m.remotePort', 'cs_irR', 'On-board'],
            [' ', '%m.direction motor velocity %m.motorVel', 'cs_drive', 'forward', 100],
            [' ', '%m.wheelDir wheel velocity %m.wheelVel', 'cs_wheel', 'left', 100],
            ['r', 'sonar sensor %m.sonarFixedPort', 'cs_sonar', 'A7, D13'],
            ['r', 'IR %m.analogPort', 'cs_ir', 'A0'],
            ['r', 'joystick X axis %m.joyPort Y axis %m.joyPort', 'cs_joystick', 'A0', 'A1'],
            ['r', 'joystick button %m.digitalPort', 'cs_joybutton', 'D5'],
            ['r', 'tilt %m.digitalPort', 'cs_tilt', 'D2'],
        ],
        menus: {
            'normalPort':['Port1', 'Port2', 'Port3', 'Port4', 'Port5', 'Port6', 'Port7', 'Port8', 'Port9'],
            'fixedPort':['Port3', 'Port10', 'Port11', 'Port12', 'Port13'],
            'hl':['high', 'low'],
            'colorSingle':['red', 'blue'],
            'color':['red', 'green', 'blue'],
            'colorValue':[255, 100, 50, 0],
            'tone': ['G3','A3','B3','C4','D4','E4','F4','G4','A4','B4','C5','D5','E5','F5'],
            'player': ['Whole', 'Half','Quarter','Eighth','Sixteenth'],
            'lightPort':['On-board', 'A0', 'A1', 'A4', 'A5'],
            'servoPort':['D3','D5','D6','D9','D10','D11'],
            'servoValue': [0,45,90,135,180],
            'analogPort': ['A0','A1','A4','A5'],
            'digitalPort': ['D2','D3','D5','D6','D9','D10','D11','D13'],
            'joyPort':['A0','A1','A4','A5'],
            'wheelDir':['left', 'right'],
            'motorVel':[255,100,50,0],
            'wheelVel':[255,100,50,0,-50,-100,-255],
            'direction':['forward', 'backward', 'left', 'right'],
            'irRCmd': ['A','B','C','D','E','F','up','down','left','right'],
            'gyroPort':['A4', 'A5'],
            'geoPort':['On-board', 'A5'],
            'tmpMicPort': ['On-board', 'A0', 'A1', 'A4', 'A5'],
            'vmPort': ['On-board', 'D2', 'D3', 'D4'],
            'sonarFixedPort': ['D11, D13'],
            'lineFixedPort':['D9, D10'],
            'axis':['x', 'y', 'z'],
            'remotePort:':['On-board'],
            'dore':['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'] // Hz
        },
        url: 'http://cafe.naver.com/smartros',
        version: '0.8.6'

    };

    // Register the extension
    ScratchExtensions.register('CodeStar Mobile', descriptor, ext, {type: 'serial'});
})();