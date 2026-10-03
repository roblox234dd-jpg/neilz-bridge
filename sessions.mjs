export class SessionRegistry {
 constructor(ownerId,{maximum=20,leaseMs=15000,now=Date.now}={}) {
  this.ownerId=ownerId;this.maximum=maximum;this.leaseMs=leaseMs;this.now=now;
  this.entries=new Map([[ownerId,Infinity]]);
 }
 prune(){for(const [id,expires] of this.entries)if(expires<=this.now())this.entries.delete(id);}
 register(id){this.prune();if(!this.entries.has(id)&&this.entries.size>=this.maximum)return false;this.entries.set(id,id===this.ownerId?Infinity:this.now()+this.leaseMs);return true;}
 renew(id){this.prune();if(!this.entries.has(id))return false;return this.register(id);}
 release(id){if(id!==this.ownerId)this.entries.delete(id);}
 get count(){this.prune();return this.entries.size;}
}
