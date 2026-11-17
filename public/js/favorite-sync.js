const ID=/^[A-Za-z0-9_-]{1,50}$/;
const MAX_ITEMS=500,MAX_TOMBSTONES=1000;
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

export function normalizeFavoriteSnapshot(value,legacy=[],timestamp=new Date().toISOString()){
  const source=value?.version===1&&Array.isArray(value.items)&&Array.isArray(value.tombstones)?value:null;
  const items=source?source.items:(Array.isArray(legacy)?legacy:[]).map(id=>({id,updatedAt:timestamp}));
  const tombstones=source?source.tombstones:[];
  const records=new Map();
  const offer=(kind,item)=>{
    if(!item||!ID.test(item.id)||!validTime(item.updatedAt))return;
    const previous=records.get(item.id);
    if(!previous||Date.parse(item.updatedAt)>Date.parse(previous.value.updatedAt)||
      (item.updatedAt===previous.value.updatedAt&&kind==='deleted'))records.set(item.id,{kind,value:{id:item.id,updatedAt:item.updatedAt}});
  };
  for(const item of items)offer('item',item);
  for(const item of tombstones)offer('deleted',item);
  const active=[],deleted=[];
  for(const record of records.values())(record.kind==='item'?active:deleted).push(record.value);
  active.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  deleted.sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt));
  return {version:1,items:active.slice(0,MAX_ITEMS),tombstones:deleted.slice(-MAX_TOMBSTONES)};
}

export function mergeFavoriteSnapshots(left,right){
  const a=normalizeFavoriteSnapshot(left),b=normalizeFavoriteSnapshot(right);
  return normalizeFavoriteSnapshot({version:1,items:[...a.items,...b.items],tombstones:[...a.tombstones,...b.tombstones]});
}

export function toggleFavoriteSnapshot(value,id,timestamp=new Date().toISOString()){
  if(!ID.test(id))return normalizeFavoriteSnapshot(value);
  const current=normalizeFavoriteSnapshot(value);
  const active=current.items.some(item=>item.id===id);
  return normalizeFavoriteSnapshot({
    version:1,
    items:active?current.items:current.items.filter(item=>item.id!==id).concat({id,updatedAt:timestamp}),
    tombstones:active?current.tombstones.filter(item=>item.id!==id).concat({id,updatedAt:timestamp}):current.tombstones.filter(item=>item.id!==id)
  });
}

export const favoriteIds=value=>normalizeFavoriteSnapshot(value).items.map(item=>item.id);
