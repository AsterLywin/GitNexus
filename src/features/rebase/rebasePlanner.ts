import { GitProcessExecutor } from "../../git/processExecutor";
import { MutationCoordinator } from "../../app/mutationCoordinator";
import { RebaseAction, RebaseTodo } from "./rebaseEditor";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export interface RebasePlan { upstream:string; todo:RebaseTodo[]; }
export class RebasePlanner {
 constructor(private readonly executor:GitProcessExecutor,private readonly timeoutMs=120000,private readonly mutation?:MutationCoordinator){}
 async commits(root:string,upstream:string):Promise<RebaseTodo[]>{const r=await this.executor.exec(["log","--reverse","--format=%H%x1f%s",`${upstream}..HEAD`],{cwd:root,timeoutMs:this.timeoutMs});return r.stdout.split(/\r?\n/).filter(Boolean).map(line=>{const [commit,subject]=line.split("\x1f");return{action:"pick" as RebaseAction,commit,subject:subject??""};});}
 async execute(root:string,plan:RebasePlan):Promise<void>{if(!plan.todo.length)throw new Error("Rebase plan is empty.");const dir=await mkdtemp(join(tmpdir(),"gitnexus-rebase-"));const sequence=join(dir,"sequence-editor.js");const todo=plan.todo.map(x=>`${x.action} ${x.commit} ${x.subject}`).join("\n")+"\n";const script=["const fs=require('node:fs');",`const todo=${JSON.stringify(todo)};`,"fs.writeFileSync(process.argv[2],todo,'utf8');"].join("\n")+"\n";await writeFile(sequence,script,"utf8");await chmod(sequence,0o700);try{const env={GIT_SEQUENCE_EDITOR:`node "${sequence}"`};if(this.mutation){await this.mutation.run({rootUri:root,operation:"rebase",args:["rebase","-i",plan.upstream],timeoutMs:this.timeoutMs,env});}else{await this.executor.exec(["rebase","-i",plan.upstream],{cwd:root,timeoutMs:this.timeoutMs,env});}}finally{await rm(dir,{recursive:true,force:true});}}
}
