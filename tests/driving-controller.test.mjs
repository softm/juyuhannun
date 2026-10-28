import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingMotionState,drivingZoomForSpeed,smoothHeading,updateDrivingMotion} from '../public/js/driving-controller.js';

test('heading smoothing crosses north without jumping south',()=>{
 const value=smoothHeading(359,1,.5);assert.ok(value<2||value>358);
});

test('stationary noisy heading preserves the last reliable travel direction',()=>{
 let state=createDrivingMotionState();
 state=updateDrivingMotion(state,{lat:37.5,lng:127,heading:80,speed:10,accuracy:10},{now:1000,manual:true});
 state=updateDrivingMotion(state,{lat:37.5,lng:127,heading:230,speed:0,accuracy:10},{now:5000,manual:true});
 assert.ok(Math.abs(state.reliableHeading-80)<1);assert.equal(state.headingSource,'held');
});

test('automatic driving requires sustained movement and pauses after a sustained stop',()=>{
 let state=createDrivingMotionState();
 state=updateDrivingMotion(state,{lat:37.5,lng:127,heading:90,speed:3,accuracy:10},{now:1000,routeActive:true});
 assert.equal(state.phase,'candidate');
 state=updateDrivingMotion(state,{lat:37.5,lng:127.001,heading:90,speed:3,accuracy:10},{now:8000,routeActive:true});
 assert.equal(state.phase,'active');
 state=updateDrivingMotion(state,{lat:37.5,lng:127.001,heading:240,speed:0,accuracy:10},{now:9000,routeActive:true});
 state=updateDrivingMotion(state,{lat:37.5,lng:127.001,heading:260,speed:0,accuracy:10},{now:25000,routeActive:true});
 assert.equal(state.phase,'paused');assert.ok(Math.abs(state.reliableHeading-90)<1);
});

test('driving zoom follows speed bands',()=>{assert.equal(drivingZoomForSpeed(0),16);assert.equal(drivingZoomForSpeed(5),15);assert.equal(drivingZoomForSpeed(15),14);assert.equal(drivingZoomForSpeed(30),13);});
