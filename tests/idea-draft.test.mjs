import test from "node:test";
import assert from "node:assert/strict";
import {IDEA_DRAFT_KEY,readIdeaDraft,writeIdeaDraft} from "../apps/landing/app/idea-draft.mjs";

function storage() { const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}; }
test("login draft survives a new page read with exact whitespace and no job intent",()=>{
 const s=storage(),idea="A lamp with a touch pad.\nNo display or sound.";
 writeIdeaDraft(s,idea,1000);
 assert.equal(readIdeaDraft(s,1100),idea);
 assert.deepEqual(Object.keys(JSON.parse(s.getItem(IDEA_DRAFT_KEY))),["idea","updatedAt"]);
 writeIdeaDraft(s,"",1200);assert.equal(readIdeaDraft(s,1300),"");
});
test("expired or malformed drafts and unavailable storage cannot block login",()=>{
 const s=storage();writeIdeaDraft(s,"idea",1000);assert.equal(readIdeaDraft(s,1000+86400000),"");
 assert.equal(s.getItem(IDEA_DRAFT_KEY),null);
 s.setItem(IDEA_DRAFT_KEY,"{bad json");assert.equal(readIdeaDraft(s),"");
 const denied={getItem(){throw Error("denied")},setItem(){throw Error("denied")},removeItem(){throw Error("denied")}};
 assert.equal(readIdeaDraft(denied),"");assert.doesNotThrow(()=>writeIdeaDraft(denied,"idea"));
});
