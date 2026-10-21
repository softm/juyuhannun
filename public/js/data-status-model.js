import {FUEL_TYPES,freshness} from './core.js';

// Re-evaluate the original observation times in the viewer's current moment.
// A successfully built status file must not keep yesterday's eligibility forever.
export function availabilityAt(data,now=Date.now()){
 const cohorts=data.availability?.priceCohorts;
 if(!Array.isArray(cohorts))return data.fuels||[];
 return FUEL_TYPES.map(({code})=>{
  let mappedStationCount=0,comparableStationCount=0;
  for(const row of cohorts){
   if(row.code!==code||!Number.isSafeInteger(row.count)||row.count<0)continue;
   mappedStationCount+=row.count;
   const observations=Array.isArray(row.observations)?row.observations:[row];
   if(observations.some(p=>freshness(p.priceUpdatedAt,p.fetchedAt,now,p.priceTimeStatus,p.sourceDate).eligible))comparableStationCount+=row.count;
  }
  return {code,mappedStationCount,comparableStationCount,historicalStationCount:mappedStationCount-comparableStationCount};
 });
}
