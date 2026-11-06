const PROJECT_ID = "weeklyplanner-v2";
const ALLOWED_ORIGIN = "https://abdos6335-netizen.github.io";
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const GROQ_BASE = "https://api.groq.com/openai/v1";

function cors(origin) {
  const allowed = origin === ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(data,status=200,origin=ALLOWED_ORIGIN){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...cors(origin)}});}
function b64url(input){return Uint8Array.from(atob(input.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(input.length/4)*4,"=")),c=>c.charCodeAt(0));}
let jwkCache=null,jwkExpiry=0;
async function verifyFirebaseToken(token){
  const parts=String(token||"").split(".");
  if(parts.length!==3)throw new Error("رمز تسجيل الدخول غير صالح.");
  const decode=s=>JSON.parse(new TextDecoder().decode(b64url(s)));
  const header=decode(parts[0]),claims=decode(parts[1]);
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=="RS256"||!header.kid)throw new Error("توقيع رمز الدخول غير مدعوم.");
  if(claims.aud!==PROJECT_ID||claims.iss!=="https://securetoken.google.com/"+PROJECT_ID||!claims.sub||claims.exp<=now||claims.iat>now+60)throw new Error("انتهت صلاحية الدخول أو أن الحساب غير معتمد.");
  if(!jwkCache||Date.now()>jwkExpiry){
    const response=await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    if(!response.ok)throw new Error("تعذر التحقق من جلسة Firebase.");
    const payload=await response.json();jwkCache=payload.keys||[];jwkExpiry=Date.now()+3600000;
  }
  const jwk=jwkCache.find(k=>k.kid===header.kid&&k.kty==="RSA");
  if(!jwk)throw new Error("مفتاح توقيع جلسة Firebase غير معروف.");
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,b64url(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));
  if(!valid)throw new Error("جلسة الدخول غير موثوقة.");
  return claims;
}
async function authorize(request,env){
  if(!env.GROQ_API_KEY)throw new Error("خدمة المحاضر غير مفعّلة على الخادم.");
  if(!env.ALLOWED_FIREBASE_UID)throw new Error("لم يتم ضبط Firebase UID المسموح به على الخادم.");
  const auth=request.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))throw new Error("سجّل الدخول إلى التطبيق أولًا.");
  const claims=await verifyFirebaseToken(auth.slice(7));
  if(claims.sub!==env.ALLOWED_FIREBASE_UID)throw new Error("هذا الحساب غير مصرح له باستخدام خدمة المحاضر.");
  return claims;
}
async function groq(path,options,env){
  const response=await fetch(GROQ_BASE+path,{...options,headers:{Authorization:"Bearer "+env.GROQ_API_KEY,...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("تعذر إكمال معالجة المحضر. حاول مرة أخرى لاحقًا.");
  return data;
}
export default {
 async fetch(request,env){
  const origin=request.headers.get("Origin")||"";
  if(origin && origin!==ALLOWED_ORIGIN)return new Response("Forbidden origin",{status:403});
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  const url=new URL(request.url);
  if(request.method!=="POST"||!["/transcribe","/minutes"].includes(url.pathname))return json({error:"Not found"},404,origin);
  try{
    await authorize(request,env);
    if(url.pathname==="/transcribe"){
      const form=await request.formData();const audio=form.get("audio");const language=form.get("language")==="en"?"en":"ar";
      if(!(audio instanceof File))return json({error:"لم يصل ملف صوتي."},400,origin);
      if(audio.size<1||audio.size>MAX_AUDIO_BYTES)return json({error:"حجم التسجيل يجب أن يكون أقل من 24 ميجابايت."},413,origin);
      const upload=new FormData();upload.append("file",audio,audio.name||"meeting-audio.m4a");upload.append("model","whisper-large-v3-turbo");upload.append("response_format","json");upload.append("temperature","0");
      if(language==="ar")upload.append("language","ar");else upload.append("language","en");
      const result=await groq("/audio/transcriptions",{method:"POST",body:upload},env);
      return json({text:String(result.text||""),model:"whisper-large-v3-turbo"},200,origin);
    }
    const input=await request.json();
    const transcript=String(input.transcript||"").trim();
    if(transcript.length<20||transcript.length>120000)return json({error:"نص الاجتماع فارغ أو أطول من الحد المسموح."},400,origin);
    const projects=Array.isArray(input.projects)?input.projects.slice(0,100).map(p=>({id:String(p.id||""),name:String(p.name||"").slice(0,160),client:String(p.client||"").slice(0,120)})):[];
    const system="You create precise professional Minutes of Meeting for interior design, fit-out, and construction meetings. Return ONLY valid JSON. Never invent facts, names, deadlines, approvals, or agreements. Put only explicitly agreed decisions in decisions. Separate discussion summary from decisions and action items. If uncertain use empty strings or arrays and add reviewNotes. projectName must be one of the supplied project names or empty. confidence is 0..1 and reflects certainty of extracting meeting metadata, not writing quality. Categories: design, shop-drawings, site, materials, client-review, general. Output schema: {title:string,projectName:string,clientName:string,category:string,minutes:string,decisions:string,actions:string,attendees:string[],confidence:number,reviewNotes:string[]}. Write clear Arabic unless the transcript is predominantly English. Use numbered headings and concise bullets in minutes; numbered list in decisions; action lines as task — owner — deadline, leaving unknown owner/deadline blank.";
    const user={transcript,knownProjects:projects,currentProjectId:input.currentProjectId||"",existingClient:input.existingClient||""};
    const completion=await groq("/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"llama-3.3-70b-versatile",temperature:0.1,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(user)}]})},env);
    const content=completion.choices?.[0]?.message?.content||"{}";
    let minutes;try{minutes=JSON.parse(content);}catch{throw new Error("تعذر إعداد محضر منسق صالح.");}
    return json({minutes},200,origin);
  }catch(error){const message=String(error?.message||error);const status=/جلسة|رمز تسجيل|سجّل الدخول|انتهت صلاحية/.test(message)?401:500;return json({error:message},status,origin);}
 }
};
