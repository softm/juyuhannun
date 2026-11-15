// Driving approach classification. Route evidence must be supplied by a routing engine.
// A geometric left/right bearing is NEVER sufficient evidence of legal access.
export const APPROACH = Object.freeze({DIRECT:'direct-right',LEFT:'left-turn-right',UTURN:'uturn-right',UNKNOWN:'unverified',BEHIND:'behind'});
export const DEFAULT_DRIVING_OPTIONS = Object.freeze({forwardOnly:true,includeTurns:true,minSpeedMps:2.5,headingToleranceDeg:75});
export function angleDelta(a,b){return ((a-b+540)%360)-180;}
export function forwardCandidate({vehicle,station,heading,tolerance=75}){
 if(!vehicle||!station||![vehicle.lat,vehicle.lng,station.lat,station.lng,heading].every(Number.isFinite))return null;
 const rad=Math.PI/180, dLon=(station.lng-vehicle.lng)*rad;
 const y=Math.sin(dLon)*Math.cos(station.lat*rad);
 const x=Math.cos(vehicle.lat*rad)*Math.sin(station.lat*rad)-Math.sin(vehicle.lat*rad)*Math.cos(station.lat*rad)*Math.cos(dLon);
 const bearing=(Math.atan2(y,x)/rad+360)%360;
 return Math.abs(angleDelta(bearing,heading))<=tolerance;
}
export function classifyApproach({vehicle,station,heading,routeEvidence,options=DEFAULT_DRIVING_OPTIONS}){
 const forward=forwardCandidate({vehicle,station,heading,tolerance:options.headingToleranceDeg??75});
 // Never discard candidates on uncertain GPS heading or low speed.
 const reliable=Number.isFinite(vehicle?.speedMps)&&vehicle.speedMps >= (options.minSpeedMps??2.5)&&Number.isFinite(heading);
 if(options.forwardOnly!==false&&reliable&&forward===false)return {type:APPROACH.BEHIND,visible:false,verified:false};
 // Route evidence: legal turns, entrance side, and actual approach verified against road graph.
 const legal=routeEvidence?.legal===true&&routeEvidence?.entranceSide==='right'&&routeEvidence?.roadMatched===true;
 let type=APPROACH.UNKNOWN;
 if(legal&&routeEvidence.turn==='none')type=APPROACH.DIRECT;
 if(legal&&routeEvidence.turn==='left')type=APPROACH.LEFT;
 if(legal&&routeEvidence.turn==='uturn')type=APPROACH.UTURN;
 return {type,visible:options.includeTurns!==false||![APPROACH.LEFT,APPROACH.UTURN].includes(type),verified:type!==APPROACH.UNKNOWN,forward,reliable};
}
export function rankApproaches(a,b){
 const priority={[APPROACH.DIRECT]:0,[APPROACH.LEFT]:1,[APPROACH.UTURN]:2,[APPROACH.UNKNOWN]:3,[APPROACH.BEHIND]:4};
 return (priority[a.type]??3)-(priority[b.type]??3);
}
