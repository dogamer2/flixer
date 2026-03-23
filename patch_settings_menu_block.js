const fs = require("fs");

const file = "/Users/jacob/Downloads/flixer/assets/js/VideoPlayer-61723096.js";
let s = fs.readFileSync(file, "utf8");

const startMarker = 'Rr=b.memo(({menuRef:r,qualities:e=[],currentQuality:t=null,onQualityChange:s,onSettingsChange:i,onWatchPartyToggle:n,isWatchPartyActive:a=!1,onShowPublicParties:o})=>{';
const endMarker = 'Rr.displayName="SettingsMenu";';

const start = s.indexOf(startMarker);
const end = s.indexOf(endMarker);

if (start === -1 || end === -1 || end <= start) {
  throw new Error("Could not locate SettingsMenu block");
}

const replacement = `Rr=b.memo(({menuRef:r,qualities:e=[],currentQuality:t=null,onQualityChange:s,onSettingsChange:i,onWatchPartyToggle:n,isWatchPartyActive:a=!1,onShowPublicParties:o})=>{
const[c]=Tr(),{isAuthenticated:l}=fi(),{t:d}=vt(),[h,f]=b.useState(()=>{const x=c.get("autoplay"),v=c.get("autonext");return pi({autoplay:x===null?null:x.toLowerCase()==="true",autoNext:v===null?null:v.toLowerCase()==="true"})}),[m,g]=b.useState(""),[y,p]=b.useState(!1),[x,v]=b.useState(!1),[S,T]=b.useState(!1),{watchPartyState:w,isWatchPartyActive:A,createWatchParty:L,joinWatchParty:R,leaveWatchParty:I,getShareLink:k,endWatchParty:F,authError:j,partyError:C}=Ft();
const P=b.useCallback(Q=>{const me={...h,...Q};f(me),rr(me),i==null||i()},[h,i]),_=b.useCallback(()=>P({autoplay:!h.autoplay}),[P,h.autoplay]),M=b.useCallback(()=>P({autoNext:!h.autoNext}),[P,h.autoNext]),N=b.useCallback(()=>P({skipIntroButton:!h.skipIntroButton}),[P,h.skipIntroButton]),D=b.useCallback(()=>{p(!0);const Q=new URL(window.location.href).pathname.split("/"),me=Q[2],ve=Q[3];let Ce,Ze;me==="tv"&&(Ce=Q[4],Ze=Q[5]),L({mediaType:me,tmdbId:ve,seasonId:Ce,episodeId:Ze})},[L]),V=b.useCallback(()=>{const Q=m.trim();Q&&(v(!0),R(Q),g(""))},[m,R]),H=b.useCallback(()=>{I()},[I]),O=b.useCallback(async()=>{const Q=k();try{await navigator.clipboard.writeText(Q),T(!0),setTimeout(()=>T(!1),2e3)}catch(me){console.error("Failed to copy link:",me)}},[k]),$=b.useCallback(()=>{window.confirm(d("player.settings.endPartyConfirm"))&&F()},[d,F]);
b.useEffect(()=>{A&&(p(!1),v(!1))},[A]);
const B=(Q,me,ve)=>u.jsxs("div",{className:"flex items-center justify-between rounded-lg bg-[#202020] px-4 py-3 border border-white/5",children:[u.jsxs("div",{children:[u.jsx("div",{className:"text-white text-base font-medium",children:Q}),u.jsx("div",{className:"text-white/60 text-sm",children:me})]}),u.jsx("button",{onClick:ve,className:"relative inline-flex h-6 w-11 items-center rounded-full transition-colors "+(ve===_&&h.autoplay||ve===M&&h.autoNext||ve===N&&h.skipIntroButton?"bg-white":"bg-white/20"),children:u.jsx("span",{className:"inline-block h-5 w-5 transform rounded-full bg-[#1f1f1f] transition-transform "+((ve===_&&h.autoplay)||(ve===M&&h.autoNext)||(ve===N&&h.skipIntroButton)?"translate-x-5":"translate-x-0.5")})})]});
return u.jsxs("div",{ref:r,className:"rounded-lg w-[680px] h-[500px] flex overflow-hidden border border-white/10",style:{backgroundColor:"#1f1f1f"},children:[
u.jsxs("div",{className:"w-[320px] flex flex-col border-r border-white/10",children:[
u.jsxs("div",{className:"px-6 py-4 border-b border-white/10",children:[u.jsx("h2",{className:"text-white text-2xl font-medium",children:d("player.settings.title")}),u.jsx("p",{className:"text-white/60 text-sm mt-1",children:d("player.settings.subtitle")})]}),
u.jsxs("div",{className:"flex-1 overflow-y-auto px-4 py-4 space-y-3",children:[
B(d("player.settings.autoplay"),d("player.settings.autoplayDesc"),_),
B(d("player.settings.autoNext"),d("player.settings.autoNextDesc"),M),
B("Skip Intro Button","Show the skip intro prompt during playback",N),
o&&u.jsx("button",{onClick:o,className:"w-full rounded-lg bg-[#202020] px-4 py-3 text-left text-white border border-white/5 hover:bg-[#262626] transition-colors",children:"Browse Public Parties"})
]})
]}),
u.jsxs("div",{className:"flex-1 flex flex-col",children:[
u.jsxs("div",{className:"px-6 py-4 border-b border-white/10",children:[u.jsx("h2",{className:"text-white text-2xl font-medium",children:d("player.settings.qualityAndParty")}),e.length>0&&u.jsx("p",{className:"text-white/60 text-sm mt-1",children:t?t.quality:d("player.settings.auto")})]}),
u.jsxs("div",{className:"flex-1 overflow-y-auto px-6 py-4 space-y-6",children:[
e.length>0&&u.jsxs("div",{children:[u.jsx("h3",{className:"text-white text-lg mb-3",children:d("player.settings.videoQuality")}),u.jsx("div",{className:"space-y-2",children:e.map(Q=>u.jsxs("button",{onClick:()=>s==null?void 0:s(Q),className:"w-full rounded-lg border px-4 py-3 text-left transition-colors "+((t==null?void 0:t.quality)===Q.quality?"bg-white/10 border-white/20":"bg-[#202020] border-white/5 hover:bg-[#262626]"),children:[u.jsx("div",{className:"text-white text-base font-medium",children:Q.quality}),(t==null?void 0:t.quality)===Q.quality&&u.jsx("div",{className:"text-white/60 text-sm mt-1",children:"Selected"})]},Q.quality))})]}),
u.jsxs("div",{children:[u.jsx("h3",{className:"text-white text-lg mb-3",children:d("player.settings.watchParty")}),l?A?u.jsxs("div",{className:"rounded-lg bg-[#202020] border border-white/5 p-4 space-y-3",children:[u.jsxs("div",{className:"flex items-center gap-3",children:[u.jsx("div",{className:"w-2 h-2 rounded-full bg-green-500"}),u.jsxs("div",{className:"text-white",children:[d("player.settings.active")," (",w.members.length," ",d("player.settings.members"),")"]})]}),u.jsx("button",{onClick:O,className:"w-full rounded-lg bg-white/10 hover:bg-white/20 text-white py-2.5 transition-colors",children:d("player.settings.sharePartyLink")}),u.jsx("button",{onClick:H,className:"w-full rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 py-2.5 transition-colors",children:d("player.settings.leaveParty")}),w.isHost&&u.jsx("button",{onClick:$,className:"w-full rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 py-2.5 transition-colors",children:d("player.settings.endParty")}),S&&u.jsx("div",{className:"rounded bg-green-500/20 px-3 py-2 text-center text-xs text-green-400",children:d("player.settings.linkCopied")})]}):u.jsxs("div",{className:"rounded-lg bg-[#202020] border border-white/5 p-4 space-y-3",children:[u.jsx("button",{onClick:D,disabled:y,className:"w-full rounded-lg bg-white/10 hover:bg-white/20 text-white py-3 font-medium transition-colors disabled:opacity-50",children:d(y?"player.settings.creating":"player.settings.startWatchParty")}),u.jsxs("div",{className:"flex gap-2",children:[u.jsx("input",{type:"text",value:m,onChange:Q=>g(Q.target.value),placeholder:d("player.settings.partyCode"),className:"flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30"}),u.jsx("button",{onClick:V,disabled:!m.trim()||x,className:"rounded-lg bg-white/10 hover:bg-white/20 text-white px-4 py-2 text-sm transition-colors disabled:opacity-50",children:d(x?"player.settings.joining":"player.settings.join")})]}),(j||C)&&u.jsx("div",{className:"rounded bg-red-500/20 px-3 py-2 text-xs text-red-400",children:j||C}),n&&u.jsx("button",{onClick:n,className:"w-full rounded-lg bg-[#1f1f1f] border border-white/10 hover:bg-[#262626] text-white py-2.5 transition-colors",children:"Open Watch Party Panel"})]}):u.jsxs("div",{className:"rounded-lg bg-[#202020] border border-white/5 p-4 text-center space-y-3",children:[u.jsx("p",{className:"text-white/60 text-sm mb-3",children:d("player.settings.signInToUseWatchParty")}),u.jsx("button",{className:"w-full py-2 rounded bg-white text-black font-medium transition-colors",onClick:()=>{window.location.href="/?overlay=login"},children:d("player.settings.signIn")}),u.jsx("button",{className:"w-full py-2 rounded bg-white/10 hover:bg-white/20 text-white transition-colors",onClick:()=>{window.location.href="/?overlay=register"},children:d("player.settings.createAccount")})]})]})
]})
]})
]})});`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(file, s);
