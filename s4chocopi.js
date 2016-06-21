
(function(ext) {
	var SCBD_CHOCOPI = 0x10,
		SCBD_CHOCOPI_USB = 0xE0,	//Chocopie USB 연결에 대한 값 디테일(상위값 14, 포트0) 을 지정
		SCBD_CHOCOPI_USB_PING = 0xE4,
		SCBD_CHOCOPI_BLE = 0xF0,	//Chocopie BLE 연결에 대한 값 디테일(상위값 15, 포트0) 를 지정	
		SCBD_CHOCOPI_BLE_PING = 0xF4,
		SCBD_SENSOR = 8,
		SCBD_TOUCH = 9,
		SCBD_SWITCH = 10,
		SCBD_MOTION = 11,
		SCBD_LED = 12,
		SCBD_STEPPER = 13, 
		SCBD_DC_MOTOR = 14,		
		SCBD_SERVO = 15;			
		//SCBD_ULTRASONIC = 0x10,		
		//SCBD_PIR = 0x11;
	/*Chocopie const definition
	 * SCBD_ULTRASONIC 와 SCBD_PIR 은 아직 존재하지않는 확장영역으로써 설계되어져있음
	*/

	var CPC_VERSION = 0x08,		//REPORT_VERSION = 0xF9 -> CPC_VERSION 으로 PATCH -- Changed By Remoted 2016.04.14
		CPC_START = 0x09,
		CPC_STOP = 0x0A,
		CPC_SET_NAME = 0x0B,
		CPC_GET_NAME = 0x0C,
		CPC_GET_BLOCK = 0x0D,
		CPC_ALL_SAY = 0x0E;
	//Chocopie command definition

  var SAMPLING_RATE = 1;

  var majorVersion = 0,
      minorVersion = 0;

  var connected = false;
  var device = null;
  

  // TEMPORARY WORKAROUND
  // Since _deviceRemoved is not used with Serial devices
  // ping device regularly to check connection
  var pingReceived = false;
  var pinger = null;
  var pingDelay = 0;
  

  function send_array(bytearray) {
  	var data = [];
  	var checksum = 0xFF;
  	data.push(0x7E);
  	for (var i = 0; i < bytearray.length; i++) {
  		if ((bytearray[i] == 0x7E) || (bytearray[i] == 0x7D)) {
  			data.push(0x7D);
  			data.push(bytearray[i]^0x20);
  			checksum ^= 0x7D;
  			checksum ^= bytearray[i]^0x20;
  		} else {
  			data.push(bytearray[i]);
  			checksum ^= bytearray[i];
  		}
  	}
  	data.push(checksum);
  	data.push(0x7E);
  	var u8a = new Uint8Array(data.length);
  	var logstring = "send:";
  	for (var i = 0; i < data.length; i++) {
  		u8a[i] = data[i];
  		logstring += data[i].toString(16) + ", ";
  	}
  	//console.log(logstring);
  	device.send(u8a.buffer); //usb 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 보냄
  }

  function deleteFromArray(a, value){
	  for(var i in a){
		  if(a[i] == value){
			  a.splice(i,1);
			  return;
		  }
	  }
  }
   
  
  function checkPing() {
    if (pingReceived){
    	pingReceived = false; //reset for next ping test
		if (!connected) {			  
			send_array([SCBD_CHOCOPI_USB, CPC_GET_BLOCK]);
	    	connected = true;
		}
		setTimeout(checkPing, 5000);		
		pingDelay=0;

    }else{
		sendPing();
		setTimeout(checkPing, 500);
		if(pingDelay<2){
			pingDelay++;
		}else{
			device.set_receive_handler(null);
			if (device) device.close();
			device=null;
			connected=false;      	
			tryNextDevice(); 			
		}
    }
  }

  function sendPing(){	
	send_array([ SCBD_CHOCOPI_USB_PING]);		//usb 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 보냄
  }

  function queryVersion() {
	send_array([SCBD_CHOCOPI_USB, CPC_VERSION]);	
  }

	function setVersion(major, minor) {
		majorVersion = major;
		minorVersion = minor;
	}


//---------------------------------------------------------------------------------------------------------------
	var s = {listener:null, packet_index: 0, packet_buffer: null, packet_lengh:0, connectedPort : {}, connectedPort_ble : {}, port : 0, detail : 0, blockList : null,		
		MOTION_START : 0x10, MOTION_STOP : 0x20, MOTION_REPORT_VALUE : 0x30, MOTION_PHOTO1_ON : 0x80, MOTION_PHOTO1_OFF : 0x90,
		MOTION_PHOTO2_ON : 0xA0, MOTION_PHOTO2_OFF : 0xB0, MOTION_ALLPHOTO_STATUS : 0xC0, 
		SWITCH_BUTTON_ON : 0x10, SWITCH_BUTTON_OFF : 0x00, SWITCH_POTENCY_VALUE : 0x30, SWITCH_JOYX_VALUE : 0x40, SWITCH_JOYY_VALUE : 0x50, SWITCH_ALLBUTTON_STATUS : 0x60,
		checksum:0,
	};
	
	function faultHandler(rb){		
		console.log(parent.name + " Error signal " + parent.port);
		s.listener = actionRoot;		
	}
	function nullBlock(){
		this.port=-1;
		this.name = "null Block";		
		var parent = this;				//2016.05.14 추가패치
		this.listener = faultHandler;
	}

	function servo_block(){
		this.name = "servo";
		this.port= -1;
		var parent = this;				//2016.05.14 추가패치
		this.listener = faultHandler;
	}	
	
	function dcMotor_block(){
		this.name = "dc motor";
		this.port= -1;
		var parent = this;				//2016.05.14 추가패치
		this.listener = faultHandler;
	}
	
	function stepper_block(){
		this.name = "stepper";
		this.port= -1;
		var parent = this;				//2016.05.14 추가패치
		this.listener = faultHandler;
	}
	
	function led_block(){
		this.name = "led";
		this.port= -1;
		var parent = this;				//2016.05.14 추가패치
		this.listener = faultHandler;
	}
	
	function sensor_block() {
		this.port= -1;
		this.sensorValues = new Array(8);
		this.menu_index = [3,4,5,6,2,7,0,1];
		this.analog_sensor2 = 0;
		this.analog_sensor3 = 0;
		this.analog_sensor4 = 0;
		this.temperature = 0;
		this.humidity = 0;
		this.light = 0;
		this.name = "sensor";		
		this.functionbit=0;
		
		var parent = this;
		this.listener = function(rb) {
			if (s.detail != 0x10){ console("detail error");		return; } //sensor block has only 1 detail
			s.packet_buffer[s.packet_index++] = rb;		
			if (s.packet_index == 1){
		  		parent.functionbit=rb;
		  		s.packet_lengh=2;
		  		for(var i=0;i<8;i++){
		  			if(rb & (1<<i) ){
		  				s.packet_lengh+=2;
		  			}
			  	}			  	
			}else if(s.packet_index === s.packet_lengh){								
				if(s.checksum!=0){
					console.log("checksum error;");
				}
			  	var value, i, data_pointer=1;
			  	for(i=0;i<8;i++){
			  		if(parent.functionbit & (1<<i) ){
			  			value=s.packet_buffer[data_pointer] + (s.packet_buffer[data_pointer+1]*256);
			  			if(i==6){ //for temperature
			  				parent.sensorValues[parent.menu_index[i]] =  value*0.01 -273.15;
			  			}else if(i==7){			  			 	
			  				parent.sensorValues[parent.menu_index[i]] =  value*0.01;
			  			}else{
			  				parent.sensorValues[parent.menu_index[i]]= value;
			  			}
			  			data_pointer+=2;			  			
			  		}			  		
			  	}		  			  	
		  		pingReceived = true;
			  	s.listener = actionRoot;
			}			
		};		
	 }

	function switch_block(){
		this.port= -1;
		this.potencyometer = 0;
		this.joyX = 0;
		this.joyY = 0;
		this.buttonStatus = new Array(6);
		this.name = "switch";
		
		for(var i=0; i < 6; i++){
			this.buttonStatus[i] = 0;
		}
		
		var parent = this;
		this.listener = function(rb) {
		  s.packet_buffer[s.packet_index++] = rb;
		  if (s.detail === s.SWITCH_BUTTON_ON){	//rb have a button id starting from 1
//			console.log(rb + " button pressed");
			 parent.buttonStatus[rb]=true; //buttonEvent is on
		  }else if (s.detail === s.SWITCH_BUTTON_OFF){
			 parent.buttonStatus[rb]=false; //buttonEvent is off
		  }else if (s.detail === s.SWITCH_POTENCY_VALUE){
			 if (s.packet_index < 2) return;
			 parent.potencyometer = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SWITCH_JOYX_VALUE){
			 if (s.packet_index < 2) return; 
			 parent.joyX = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SWITCH_JOYY_VALUE){
			 if (s.packet_index < 2) return; 
			 parent.joyY = s.packet_buffer[0] + s.packet_buffer[1] * 256;
		  }else if (s.detail === s.SWITCH_ALLBUTTON_STATUS){
			 for(var i=0; i < 5; i++){
				var sw_status = (rb >> i) & 0x01;
				parent.buttonStatus[i+1] = (sw_status === 1)? true : false;
			 }
		  }
		  pingReceived = true;
		  s.listener = actionRoot;
		};
		
	}
	//Boolean 패치 완료
	
	function touch_block(){
		this.port= -1;
		this.touchStatus =0;
		this.touchValues= new Array(12);
		this.higherThan = 0;
		this.lowerThan = 0;
		
		
		this.name = "touch";
		var parent = this;
		
		this.listener = function(rb) {
			s.packet_buffer[s.packet_index++] = rb;		
			switch(s.detail){				
				case 0x10: // DTT_PRESSED
					if (s.packet_index < 2) return;
					parent.touchStatus= s.packet_buffer[0]+s.packet_buffer[1]*256;				
				break;
				case 0x20: //RELEASED
					if (s.packet_index < 2) return;
					parent.touchStatus &= ~(s.packet_buffer[0]+s.packet_buffer[1]*256);					
				break;
				case 0x30: // STATUS
					if (s.packet_index < 2) return;
					parent.touchStatus= s.packet_buffer[0]+s.packet_buffer[1]*256;
				break;
				case 0x40: // HIGHER THAN EVENT
					if (s.packet_index < 2) return;
					parent.higherThan= s.packet_buffer[0]+s.packet_buffer[1]*256;
				break;
				case 0x50: // LOWER THAN EVENT
					if (s.packet_index < 2) return;
					parent.lowerThan= s.packet_buffer[0]+s.packet_buffer[1]*256;
				break;
				case 0x60: // TOUCH VALUE
					if (s.packet_index < 24) return;
					parent.touchValues= s.packet_buffer[0]+s.packet_buffer[1]*256;
				break;
			}
			pingReceived = true;
			s.listener = actionRoot;
		};				
	}
	//Boolean 패치 완료
	
	function motion_block(){
		this.port= -1;
		this.values = new Array(11);
		this.photoGateTime = [[0,0],[0,0]];		
		
		

		this.name = "motion";

		var parent = this;
		
		this.listener = function(rb) { //values index: 0,1,2: IR, 345 xyz, 678:uvw, 9,10:photogate
			//console.log("motion started");
			s.packet_buffer[s.packet_index++] = rb;				
			//console.log("s.detail " + s.detail);
		  if (s.detail === s.MOTION_START){
			  if (s.packet_index < 6) return;
			  parent.values[0] = s.packet_buffer[0] + s.packet_buffer[1] * 256;
			  parent.values[1] = s.packet_buffer[2] + s.packet_buffer[3] * 256;
			  parent.values[2] = s.packet_buffer[4] + s.packet_buffer[5] * 256;
		  }else if (s.detail === s.MOTION_ACCEL_VALUE){
			  if (s.packet_index < 6) return;
			  parent.values[3] = s.packet_buffer[0] + s.packet_buffer[1] * 256;
			  parent.values[4]= s.packet_buffer[2] + s.packet_buffer[3] * 256;
			  parent.values[5]= s.packet_buffer[4] + s.packet_buffer[5] * 256;
		  }else if (s.detail === s.MOTION_PACCEL_VALUE){
			  if (s.packet_index < 6) return;
			  parent.values[6] = s.packet_buffer[0] + s.packet_buffer[1] * 256;
			  parent.values[7] = s.packet_buffer[2] + s.packet_buffer[3] * 256;
			  parent.values[8] = s.packet_buffer[4] + s.packet_buffer[5] * 256;
		  }else if ((s.detail === s.MOTION_PHOTO1_ON)){
			  if (s.packet_index < 4) return;
			  parent.values[9] = 1;
			  parent.photoGateTime[0][1]= s.packet_buffer[0] + s.packet_buffer[1] * 256 + s.packet_buffer[2] * 256 * 256 + s.packet_buffer[3] * 256 * 256 * 256;
		  }else if ((s.detail === s.MOTION_PHOTO1_OFF)){
			  if (s.packet_index < 4) return;
			  parent.values[9] = 0;
			  parent.photoGateTime[0][0] = s.packet_buffer[0] + s.packet_buffer[1] * 256 + s.packet_buffer[2] * 256 * 256 + s.packet_buffer[3] * 256 * 256 * 256;
		  }else if ((s.detail === s.MOTION_PHOTO2_ON)){
			  if (s.packet_index < 4) return;
			  parent.values[10] = 1;
			  parent.photoGateTime[1][0] = s.packet_buffer[0] + s.packet_buffer[1] * 256 + s.packet_buffer[2] * 256 * 256 + s.packet_buffer[3] * 256 * 256 * 256;
			}else if ((s.detail === s.MOTION_PHOTO2_OFF)){
			  if (s.packet_index < 4) return;
			  parent.values[10] = 0;
			  parent.photoGateTime[1][1]  = s.packet_buffer[0] + s.packet_buffer[1] * 256 + s.packet_buffer[2] * 256 * 256 + s.packet_buffer[3] * 256 * 256 * 256;			  
		  }else if (s.detail === s.MOTION_ALLPHOTO_STATUS){
			 if (s.packet_index < 1) return;
			 parent.values[9]  = (s.packet_buffer[0] & 0x01);
			 parent.values[10]  = (s.packet_buffer[0] & 0x01) >> 1;			 
		  }
		  pingReceived = true;
		  s.listener = actionRoot;
		};
	}

	function gotVersion(rb){
		s.packet_buffer[s.packet_index++] = rb;		
		if(s.packet_index === 9){
			pingReceived = true;
			setVersion(s.packet_buffer[7], s.packet_buffer[8]);
			s.listener = actionRoot;
			pingReceived=true;
			return;
		}
	}
	
	function gotPing(){
		pingReceived = true;
		s.listener = actionRoot;
		return;	
	}

	function actionRoot(rb){
		s.packet_index = 0;
		if (rb < 0xE0){
			s.detail = rb & 0xF0;
			s.port = rb & 0x0F;
			//console.log("listener is of " +  s.blockList[s.port].name );	
			s.listener = s.blockList[s.port].listener;	//각 블록의 해당함수 파서에게 뒷일을 맡김.
		}else{
			s.listener = actionChocopi;
			if(rb === SCBD_CHOCOPI_USB_PING) gotPing();	
			if (rb === (SCBD_CHOCOPI_USB | 0x01)){
				s.listener = gotConnectedBlock;	
			}else if (rb === (SCBD_CHOCOPI_USB | 0x02)){
				s.listener = gotDisconnectedBlock;
			}else if (rb === (SCBD_CHOCOPI_BLE | 0x03)){	//BLE 연결 상태에 대한 정의
				s.listener = bleChanged;
			}else if(rb === (SCBD_CHOCOPI_USB | 0x0F)){		//에러코드에 대한 정의
				s.listener = reportError;
			}
		}
		//console.log("action is" + s.listener );
		return;
	}
	
	function reportError(rb){
		s.packet_buffer[s.packet_index++] = rb;
		if (s.packet_index === 10){
			console.log("에러발생 오류코드 : " + s.packet_buffer[0] + s.packet_buffer[1] );	
			console.log("데이터 : " + s.packet_buffer[2] + s.packet_buffer[3] + s.packet_buffer[4] + s.packet_buffer[5] + s.packet_buffer[6] + s.packet_buffer[7] + s.packet_buffer[8] + s.packet_buffer[9]);
			//오류코드 (2 Byte), 참고데이터 (8 Byte)
			pingReceived = true;
			s.listener = actionRoot;
		}
		return;
	}

	function actionChocopi(rb){
		s.packet_index=0; //start from 	
		if(rb === CPC_VERSION)
			s.listener=gotVersion;
		if(rb === CPC_GET_BLOCK)
			s.listener=actionGetBlock;
		return;
	}

	function bleChanged(rb){
		if (rb === 0){	//연결해제
			for (var i=8; i < 16; i++){							//STATUS (inputData, storedInputData)
				disconectBlock(i);									//2016.04.30 재패치
			}
			console.log("BLE is disconnected");
		}else if (rb === 1){
			console.log("BLE is connected");
		}	
		pingReceived = true;
		s.listener = actionRoot;	
		return;
	}

	function gotDisconnectedBlock(rb){
		disconectBlock(rb);	// PORT	(inputData, storedInputData)		inputData[0] 번이 0xE2 인 경우, 이어서 포트(1 Byte) 가 전송됨
		console.log("Removed block port " + rb);
		pingReceived = true;
		s.listener = actionRoot;
		return;
	}
	
	function gotConnectedBlock(rb){
		s.packet_buffer[s.packet_index++] = rb;
		if (s.packet_index === 3){
			var block_type = s.packet_buffer[1] + s.packet_buffer[2]*256 ,
			connected_port = s.packet_buffer[0];
			connectBlock(block_type, connected_port);
			//PORT, BLOCK_TYPE(LOW), BLOCK_TYPE(HIGH)	(inputData)
			pingReceived = true;
			s.listener = actionRoot;
		}
		return;
	}
	
	function actionGetBlock(rb){
		// detail/port, CPC_GET_BLOCK 를 제외한 포트가 LOW 8 Bit, HIGH 8 Bit 순으로 등장함
		s.packet_buffer[s.packet_index++] = rb;
		var rp = 0;
		if(s.packet_index <32) return;
		for (var port = 0 ; port < 16; port++){
			var block_type = s.packet_buffer[rp++];
				block_type += s.packet_buffer[rp++]*256;						
			connectBlock(block_type, port);	
		}
		pingReceived = true;
		s.listener = actionRoot;
		return;
	}
	
	function processInput(dataBuffer) {
		
		var isEscaping = false;
		var i=0;
		var rb=0;
		var logString="get:";
		var inputData = new Uint8Array(dataBuffer);
		for (var i in  inputData){
			rb=inputData[i];
			logString+=" " + rb.toString(16);
			if(rb === 0x7E){
				s.listener=actionRoot;
				s.checksum=0xFF;
			}else{				
				if(rb==0x7D){
					isEscaping=true;
				}else{
					if(isEscaping === true){
						rb=rb ^ 0x20;
					}
					isEscaping=false;
					checksum= checksum ^ rb;
					s.listener(rb);	
					
				}
			}
		}
		//console.log(logString);
	}

//-------------------------------------------------------------------SAMPLING FUNCTION START -- 2016.05.11 재패치 완료
	function set_sampling_rate(port, functionbit){
		send_array([ 0x10 | port, functionbit ,  SAMPLING_RATE & 0xFF, SAMPLING_RATE >>8]);			
	};

	function connectBlock (block_id, port) {
		if(block_id === 0x00) return;	
		switch(block_id){
			case SCBD_SENSOR: s.blockList[port] = new sensor_block(); set_sampling_rate(port,0xDF); break;
			case SCBD_TOUCH:  s.blockList[port] = new touch_block(); set_sampling_rate(port,0x0F); break;
			case SCBD_SWITCH: s.blockList[port] = new switch_block(); set_sampling_rate(port,0x0F); break;
			case SCBD_MOTION: s.blockList[port] = new motion_block(); set_sampling_rate(port,0x0F); break;
			case SCBD_LED:	s.blockList[port] = new led_block();	break;
			case SCBD_STEPPER:	s.blockList[port] = new stepper_block(); break;
			case SCBD_DC_MOTOR: s.blockList[port] = new dcMotor_block(); break;
			case SCBD_SERVO: s.blockList[port] = new servo_block(); break;			
		}
		s.connectedPort[ s.blockList[port].name ].push(port);		
		s.blockList[port].port = port;
		console.log( s.blockList[port].name + " block connected to port " + port );
	}
	
	function disconectBlock(port){
		if(port>16) return;
		var block_name = s.blockList[port].name;		
		deleteFromArray(s.connectedPort[ block_name ], port);	
		console.log(block_name + " block disconected from port" + port);
	}

	function getConnectedPort(name, portname){
		var port= menu_index['port'][portname]; //findout index by the name of scratch icon menu
		if(s.blockList[port].name === name ) return port; //if the port is correct than you got it.		
		if(s.connectedPort[name].length==0) return -1; //if there is no block by that name, -1
		return s.connectedPort[name][s.connectedPort[name].length -1]; //get the latest port
	}


//----------------------------------------------------------------------------------- SYSTEM FUNCTION LINE 
  	ext._getStatus = function() {
			if(!connected) return {status: 1, msg: 'ChocopieBoard disconnected'};
			else return {status: 2, msg: 'ChocopieBoard connected'};			
	};
			

  ext._deviceRemoved = function(dev) {
    console.log('Device removed');
    // Not currently implemented with serial devices
  };

  var potentialDevices = [];
  ext._deviceConnected = function(dev) {
    potentialDevices.push(dev);
    if (!device)
      tryNextDevice();
  };

  
  function tryNextDevice() {
    device = potentialDevices.shift();
    if (!device) return;

    device.open({ stopBits: 0, bitRate: 115200, ctsFlowControl: 0 });
    console.log('Attempting connection with ' + device.id);
    device.set_receive_handler(processInput);
    sendPing();    
    setTimeout(checkPing,200);
  }

  ext._shutdown = function() {
    // TODO: Bring all pins down
    if (device) device.close();
    if (poller) clearInterval(poller);
    device = null;
  };	

  ext.reportSensor = function(port, sensorType){
		port=getConnectedPort('sensor',port);
		if (port === -1) return 0;
		var object = s.blockList[port];
		var sensor_index=menu_index['sensorType'][sensorType];		
		if(sensor_index<8) return object.sensorValues[sensor_index];
		return 0;		
	};

	ext.isTouchButtonPressed = function(port, touch){	//이벤트성 터치블록이 아닌, 일반 터치블록
		port=getConnectedPort('touch',port);
		if (port === -1) return 0;
		var object = s.blockList[port];
		
		return( ( object.touchStatus  & (1<<menu_index['touch'][touch] )) ? 1:0 );
			
	};
	
	ext.whenTouchButtonChandged = function(port, touch, btnStates){	//이벤트성 터치블록
		port=getConnectedPort('touch',port);		
		if (port === -1) return false;
		var object = s.blockList[port];
		var status = ( object.touchStatus  & (1<<menu_index['touch'][touch])  ) ? 1:0;
		
		return( status == btnStates );
	};
	

	
	ext.whenButtonChange = function(port, sw, btnStates) {
		port=getConnectedPort('switch',port);		
		if (port === -1) return false;
		var object = s.blockList[port];	
		var sw_index = menu_index['sw'][sw];		
		btnStates = (btnStates ==1) ? true:false;
		if(object.buttonStatus[sw_index+1] == btnStates){			
			return true;
		}		
		return false;			
	};
	
	ext.isSwButtonPressed = function(port, sw){
		port=getConnectedPort('switch',port);
		if (port === -1) return;
		var sw_index = menu_index['sw'][sw];
		return s.blockList[port].buttonStatus[sw_index+1];
		
	};
	//2016.05.01 스위치 블록 boolean 패치에 따라서 생겨난 함수
	//2016.05.13 Boolean 패치 완료
	
	ext.reportJogValue = function(port, buttons){
		// 조이스틱X, 조이스틱Y, 포텐시오미터
		port=getConnectedPort('switch',port);
		if (port === -1) return;
		var object = s.blockList[port];	
		var index=  menu_index['buttons'][buttons];
		switch(index){
			case 0: return object.joyX;
			case 1: return object.joyY;
			case 2:	return object.potencyometer;
		}
	};
	//REPOTER PATCH CLEAR

	ext.motionbRead = function(port, motionb){
		port=getConnectedPort('motion',port);
		if (port === -1) return;
		return s.blockList[port].values[ menu_index['motionb'][motionb] ];		
	};
	

	ext.whenPhotoGate = function(port, photoGate ,gateState){		//이벤트성 포토게이트 hat블록에 이어짐
		port=getConnectedPort('motion',port);
		if (port === -1) return;
		var object = s.blockList[port];
		var photogate_index = menu_index['photoGate'][photoGate] ;
		var gateState_index = menu_index['gateState'][gateState] ; 
	
		if(object.values[photogate_index + 9 ] == gateState_index ){ 			
			return true;
		} return false;		
		
	};

	ext.passLEDrgb = function(port, ledPosition, r, g, b){
		port=getConnectedPort('led',port);
		if (port === -1) return;		
		var dnp = 0x00| port;
		send_array([dnp, ledPosition,g,r,b]);		
	};

	ext.passBUZEER = function(port, pitch, playtime){
		port=getConnectedPort('led',port);

		if (port === -1) return;
		var dnp = 0x80| port;
		var data = new Array(5);
		data[0]=dnp;
		data[1]=pitch ;
		for(var i=2;i<6;i++){			
			data[i]=playtime & 0xFF;
			playtime>>=8;
		} 
		send_array(data);
	};

	ext.passSteppingAD = function(port, steppingMotor, speed, stepDirection){
		port=getConnectedPort('stepper',port);
		if (port === -1) return;
		var d=0, isDirectionCW; 		
		var motor_id = menu_index['steppingMotor'][steppingMotor];

		if (menu_index['stepDirection'][stepDirection]==0){	//시계방향
			isDirectionCW = true;			
		}else{	//반시계방향
			isDirectionCW = false;
		}
		if(speed<0 ){
			speed = -speed;
			isDirectionCW = !isDirectionCW;
		}
		d = (isDirectionCW) ? 0x10:0x00;
		d += motor_id*0x20;
		d |= port;

		if(speed>200) speed = 200; //rpm
		speed *= 100; 
		speed = Math.round(speed);
		var data = [d, speed & 0xFF , speed>>=8];
		send_array(data);

	};

	ext.passSteppingADA = function(port, steppingMotor, speed, stepDirection, rotation_amount){
		//console.log('passSteppingADA is run');
			port=getConnectedPort('stepper',port);
		if (port === -1) return;
		var d=0, isDirectionCW; 		
		var motor_id = menu_index['steppingMotor'][steppingMotor];

		if (menu_index['stepDirection'][stepDirection]==0){	//시계방향
			isDirectionCW = true;			
		}else{	//반시계방향
			isDirectionCW = false;
		}
		if(speed<0 ){
			speed = -speed;
			isDirectionCW = !isDirectionCW;
		}
		d = (isDirectionCW) ? 0x10:0x00;
		d += 0x80 + motor_id * 0x20;
		d |= port;

		if(speed>200) speed = 200; //rpm
		speed *= 100; 
		speed = Math.round(speed);
		
		var data = [d, speed & 0xFF , speed>>=8];
		
		
		rotation_amount = Math.round(rotation_amount * 40/9)
		
		data.push(rotation_amount & 0xFF);	rotation_amount>>=8;
		data.push(rotation_amount & 0xFF);	rotation_amount>>=8;
		data.push(rotation_amount & 0xFF);	rotation_amount>>=8;
		data.push(rotation_amount & 0xFF);	
		
		send_array(data);
	};

	ext.setDcMotorSpeed = function(port, dcMotor, speed, stepDirection){
		port=getConnectedPort('dc motor',port);
		if (port === -1) return;
		var motor_num = menu_index['dcMotor'][dcMotor];
		var dnp = (motor_num +1)<<4;
		dnp |= port;
		
		if(speed > 1024){ speed= 1024; }else if (speed < 0){speed= 0;}

		direction= ( menu_index['stepDirection'][stepDirection] == 0) ? 1: 0;
			
		send_array([dnp,direction, speed & 0xFF, speed>>8]);		
	};

	ext.setServoAngle = function(port, servos, degree) {		
		port=getConnectedPort('servo',port);		
		if (port === -1) return;		//일반일때도, 무선일때도, servo 의 갯수가 하나도 없다면 되돌림
		if (degree > 180){
			degree = 180;
		}else if(degree < 0){
			degree = 0;
		}
		degree*=100; //
		var motor_num = menu_index['servos'][servos];
		var dnp = (motor_num +1)<<4;
		dnp |= port;
		send_array([dnp,degree & 0xFF, degree >> 8 ]);
	};

	//Function added Line - end  --------------------------------------------------------------------------------------

  var blocks = {
    en: [
      ['r', 'read from %m.port to %m.sensorType', 'reportSensor', 'Port1','temperature sensor'],		//light, temperature, humidity and analog sensor combined (normal, remote)
      ['-'],																						//function_name: reportSensor
	  ['r', '%m.port touch sensor %m.touch is pressed?', 'isTouchButtonPressed', 'Port1', 1],		//Touch Sensor is boolean block (normal, remote)
	  ['h', 'when %m.port touch sensor %m.touch is %m.btnStates', 'whenTouchButtonChandged', 'Port1', 1, 0],		//function_name : isTouchButtonPressed	whenTouchButtonChandged
      ['-'],
      ['h', 'when %m.port sw block %m.sw to %m.btnStates', 'whenButtonChange', 'Port1', 'Button 1', 0],	//sw block (button 1, .. )		function_name :
      ['r', '%m.port sw block %m.buttons of value', 'reportJogValue', 'Port1','Joystick X'],			//buttons ( button 1, 2, 3, 4)	whenButtonChange
	  ['b', '%m.port sw block %m.sw of value', 'isSwButtonPressed', 'Port1','Button 1'],					//Joystick and Potencyometer	reportJogValue
	  ['-'],																									
	  ['r', '%m.port motion-block %m.motionb of value', 'motionbRead', 'Port1','infrared 1'],								//Motion block is infrared, acceler and so on
	  ['h', 'when %m.port motion-block %m.photoGate is %m.gateState', 'whenPhotoGate', 'Port1', 'photoGate 1', 'blocked'],	//function_name : motionbRead	whenPhotoGate	
	  ['-'],
	  [' ', '%m.port LED LOCATION %n RED %n GREEN %n BLUE %n', 'passLEDrgb', 'Port1', 0, 0, 0, 0],		//LED block is defined.	function_name : passLEDrgb
	  [' ', '%m.port BUZZER PITCH %n DURATION %n seconds', 'passBUZEER', 'Port1', 0, 1000],			//Buzzer block is defined. function_name : passBUZEER
	  ['-'],
	  [' ', '%m.port %m.steppingMotor Accel %n Direction %m.stepDirection', 'passSteppingAD', 'Port1', 1, 0, 'clockwise'],
	  [' ', '%m.port %m.steppingMotor Accel %n Direction %m.stepDirection Angle %n', 'passSteppingADA', 'Port1', 1, 0, 'clockwise', 0],

	  ['-'],
	  [' ', '%m.port %m.dcMotor Accel %n Direction %m.stepDirection', 'setDcMotorSpeed', 'Port1', 'DC motor 1', 50, 'clockwise'],
	  ['-'],
	  [' ', '%m.port  %m.servos to %n degrees', 'setServoAngle', 'Port1', 'Servo 1', 90]
    ],
    ko: [																						
      ['r', '%m.port 센서 %m.sensorType 의 값', 'reportSensor', '포트1', '온도'],										// 조도, 온도, 습도, 아날로그 통합함수 (일반, 무선)
      ['-'],																											// function_name = reportSensor
	  ['r', '%m.port 터치 %m.touch 의 값', 'isTouchButtonPressed', '포트1', 1],									//Touch Sensor is boolean block	-- normal and remote					
	  ['h', '%m.port 터치 %m.touch 가 %m.btnStates 가 될 때', 'whenTouchButtonChandged', '포트1', 1, 0],		//function_name : isTouchButtonPressed	whenTouchButtonChandged
	  ['-'],																											//function_name : isTouchButtonPressed 
      ['h', '%m.port 스위치 %m.sw 이 %m.btnStates 될 때', 'whenButtonChange', '포트1', '버튼1', 0],				//sw block (button 1, .. )
      ['r', '%m.port 스위치 %m.buttons 의 값', 'reportJogValue', '포트1','조이스틱X'],							//buttons ( button 1, 2, 3, 4, J)				
	  ['b', '%m.port 스위치블록 %m.sw 의 값', 'isSwButtonPressed', '포트1','버튼1'],							//Joystick and Potencyometer function is combined.
	  ['-'],																										//function_name :  reportJogValue	whenButtonChange
	  ['r', '%m.port 모션 %m.motionb 의 값', 'motionbRead', '포트1','적외선 감지1'],								//Motion block is infrared, acceler and so on
	  ['h', '%m.port 모션 %m.photoGate 가 %m.gateState', 'whenPhotoGate', '포트1', '포토게이트 1', '막힐때'],	//function_name : motionbRead	whenPhotoGate	
	  ['-'],																	//LED RGB definition
	  [' ', '%m.port LED 위치 %n 빨강 %n 녹색 %n 파랑 %n', 'passLEDrgb', '포트1', 0, 0, 0, 0],		//LED block is defined.	function_name : passLEDrgb
	  [' ', '%m.port 버저 음높이 %n 연주시간 %n 밀리초', 'passBUZEER', '포트1', 0, 1000],			//Buzzer block is defined. function_name : passBUZEER
	  ['-'],
	  [' ', '%m.port %m.steppingMotor 속도 %n 방향 %m.stepDirection', 'passSteppingAD', '포트1', '스테핑모터1', 0, '시계'],
	  [' ', '%m.port %m.steppingMotor 속도 %n 방향 %m.stepDirection 회전량 %n', 'passSteppingADA', '포트1', '스테핑모터1', 0, '시계', 0],
		//Stepping Motor is defined.
		//function_name : passSteppingAD	passSteppingADA
	  ['-'],																											//DC motor is defined
	  [' ', '%m.port %m.dcMotor 번 DC모터 속도 %n 방향 %m.stepDirection', 'setDcMotorSpeed', '포트1', 'DC모터1', 0, '시계'],		//function_name : passDCDA passRDCDA	
	  ['-'],
	  [' ', '%m.port  %m.servos 각도 %n', 'setServoAngle', '포트1',  '서보모터1', 90]	//ServoMotor, Multiple Servo and Remote Servo is defined.
    ]
  };

  var menus = {
    en: {
		buttons: ['Joystick X', 'Joystick Y', 'Potencyometer'],
		sw: ['Button 1', 'Button 2', 'Button 3', 'Button 4', 'Button J'],
		//Buttons, Joystick sensor and potencyometer sensor listing

		btnStates: [0, 1],
		//0 : pressed  1: released

		sensorType: [ 'temperature sensor', 'humidity sensor', 'light sensor', 'Analog 1', 'Analog 2', 'Analog 3', 'Analog 4'],						
		//Analog Sensor and Analog Sensor for 1, 2, 3 and 4 added

		outputs: ['on', 'off'],
		ops: ['>', '=', '<'],
		servos: ['Servo 1', 'Servo 2', 'Servo 3', 'Servo 4'],

		port: ["Port1", "Port2","Port3","Port4","Port5","Port6","Port7","Port8"," BLE1","BLE2","BLE3","BLE4","BLE5","BLE6","BLE7","BLE8"],
		

		touch: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
		// Touch sensor and Remoted touch sensor listing
	
		motionb: ['infrared 1', 'infrared 2', 'infrared 3', 
			'acceler X', 'acceler Y', 'acceler Z', 
			'pacceler U', 'pacceler V', 'pacceler W', 
			'photoGate 1', 'photoGate 2'],
		photoGate: ['photoGate 1', 'photoGate 2'],
		gateState: ['blocked','opened'],
		//infrared sensor and acceler and pacceler sensor listing
		//photogate and gate status is defined.

		steppingMotor: ['Step Motor 1', 'Step Motor 2'],
		stepDirection:['clockwise','declockwise'],
		//steppingMotor is defined.

		dcMotor: ['DC motor 1', 'DC motor 2','DC motor 3'],
		//dcMotor is defined.

    },
    ko: {
		buttons: ['조이스틱X', '조이스틱Y', '포텐시오미터'],
		sw : ['버튼1', '버튼2', '버튼3', '버튼4', '버튼J'],
		//Joystick sensor and potencyometer sensor listing

		btnStates: [0, 1],
		// 0 : 눌림  1 : 떼짐

		sensorType: ['온도', '습도','조도','아날로그1', '아날로그2', '아날로그3', '아날로그4'],
		// light, temperature and humidity and Analog Sensor for 1, 2, 3 and 4 is defined.

		outputs: ['켜기', '끄기'],
		ops: ['>', '=', '<'],
		servos: ['서보모터1', '서보모터2', '서보모터3', '서보모터4'],
		port: ["포트1"," 포트2"," 포트3"," 포트4"," 포트5"," 포트6"," 포트7"," 포트8"," 무선1","무선2","무선3","무선4","무선5","무선6","무선7","무선8"],

		touch: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
		// Touch sensor listing

		motionb: ['적외선 감지1', '적외선 감지2', '적외선 감지3','가속도X', '가속도Y', '가속도Z', '각가속도U', '각가속도V', '각가속도W', 
			'포토게이트1', '포토게이트2'],
		photoGate: ['포토게이트1', '포토게이트2'],
		gateState: ['막힐때','열릴때'],
		//infrared sensor and acceler and pacceler sensor listing
		//photogate and gate status is defined.

		steppingMotor: ['스테핑모터1', '스테핑모터2'],
		stepDirection:['시계','반시계'],
		//steppingMotor is defined.

		dcMotor: ['DC모터1', 'DC모터2', 'DC모터3'],
		//dcMotor is defined.
    }
  };
  // Check for GET param 'lang'
  var paramString = window.location.search.replace(/^\?|\/$/g, '');
  var vars = paramString.split("&");
  var lang = 'en';
  for (var i=0; i<vars.length; i++) {
    var pair = vars[i].split('=');
    if (pair.length > 1 && pair[0]=='lang')
      lang = pair[1];
  }
  
  var menu_index={};
  function initialiseValues(language){
	  for( var icon in menus[language]){			  
		menu_index[icon]={};		
		var i=0;
		for(var  text in menus[language][icon]){
			menu_index[icon][ menus[language][icon][i]]=i++;			
		}
	  }	  
	  var block_names=['sensor','switch','led','servo','dc motor','stepper','motion','touch','null Block'];
	  for(var i in block_names) s.connectedPort[block_names[i]]=[];
	  
  }
  initialiseValues(lang);
  
	s.listener=actionRoot;
	s.packet_buffer = new Array(1024);
	s.blockList = new Array(16);

	for(var i=0; i < 16; i++){
		s.blockList[i] = new nullBlock();
	}

  var descriptor = {
    blocks: blocks[lang],
    menus: menus[lang],
    url: 'http://chocopi.github.io/s4chocopi.js'    
  };

  ScratchExtensions.register('ChocoPi Board', descriptor, ext, {type:'serial'});

})({});