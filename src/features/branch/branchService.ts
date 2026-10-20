import { GitProcessExecutor } from "../../git/processExecutor";
export interface BranchInfo { name:string; current:boolean; upstream?:string; ahead:number; behind:number; }
export class BranchService {
  constructor(private readonly executor:GitProcessExecutor, private readonly timeoutMs=30000){}
  async list(root:string):Promise<BranchInfo[]> {
    const r=await this.executor.exec(["for-each-ref","--format=%(refname:short)%x1f%(HEAD)%x1f%(upstream:short)%x1f%(upstream:track)","refs/heads"],{cwd:root,timeoutMs:this.timeoutMs});
    return r.stdout.split(/\r?\n/).filter(Boolean).map(line=>{const [name,head,upstream,track]=line.split("\x1f");const m=track.match(/\[ahead (\d+), behind (\d+)\]|\[ahead (\d+)\]|\[behind (\d+)\]/);return{name,current:head==="*",upstream:upstream||undefined,ahead:Number(m?.[1]??m?.[3]??0),behind:Number(m?.[2]??m?.[4]??0)};});
  }
  async create(root:string,name:string,startPoint="HEAD"){validateBranchName(name);await this.executor.exec(["branch",name,startPoint],{cwd:root,timeoutMs:this.timeoutMs});}
  async checkout(root:string,name:string){validateBranchName(name);await this.executor.exec(["switch",name],{cwd:root,timeoutMs:this.timeoutMs});}
  async delete(root:string,name:string,force=false){validateBranchName(name);await this.executor.exec(["branch",force?"-D":"-d",name],{cwd:root,timeoutMs:this.timeoutMs});}
  async rename(root:string,oldName:string,newName:string){validateBranchName(oldName);validateBranchName(newName);await this.executor.exec(["branch","-m",oldName,newName],{cwd:root,timeoutMs:this.timeoutMs});}
}
function validateBranchName(name:string){if(!name||name.startsWith("-")||/[\x00\x7f]/.test(name))throw new Error("Invalid branch name.");}
