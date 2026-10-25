import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {mergeStationData} from '../public/js/data-loader.js';
import {ServiceError} from './errors.mjs';

async function readSnapshot(path,{ignoreInvalid=false}={}){
  try{
    const value=JSON.parse(await readFile(path,'utf8'));
    if(!value||!Array.isArray(value.stations))throw new Error('stations missing');
    return value;
  }catch(error){
    if(error?.code==='ENOENT'||ignoreInvalid)return null;
    throw new ServiceError('STATION_SNAPSHOT_INVALID','배포된 주유소 자료를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

export class StationSnapshotStore{
  constructor({projectRoot,clock=Date.now,ttlMs=60_000}={}){
    this.projectRoot=projectRoot;this.clock=clock;this.ttlMs=ttlMs;this.cached=null;this.loading=null;
  }

  async load(){
    if(this.cached&&this.clock()-this.cached.at<this.ttlMs)return structuredClone(this.cached.value);
    if(this.loading)return structuredClone(await this.loading);
    this.loading=this.#load().finally(()=>{this.loading=null;});
    return structuredClone(await this.loading);
  }

  async #load(){
    const publicRoot=resolve(this.projectRoot,'public');
    const searchPath=resolve(publicRoot,'data/nationwide/search.json');
    const latestPath=resolve(publicRoot,'data/nationwide/latest.json');
    const regionalPath=resolve(publicRoot,'data/stations.json');
    // Match the browser loader: a missing or half-published search index falls
    // back to the last complete nationwide snapshot.
    const search=await readSnapshot(searchPath,{ignoreInvalid:true});
    const nationwide=search?.stations?.length?search:await readSnapshot(latestPath);
    const regional=await readSnapshot(regionalPath);
    if(!nationwide&&!regional)throw new ServiceError('STATION_SNAPSHOT_MISSING','배포된 주유소 자료가 없어 경로 후보를 확인할 수 없습니다.',503);
    const merged=mergeStationData(nationwide,regional,{now:this.clock()});
    let revision=null;
    try{
      const stamps=await Promise.all([searchPath,latestPath,regionalPath].map(path=>stat(path).then(info=>info.mtimeMs).catch(()=>0)));
      revision=String(Math.max(...stamps));
    }catch{}
    const value={...merged,revision};
    this.cached={at:this.clock(),value};
    return value;
  }
}
