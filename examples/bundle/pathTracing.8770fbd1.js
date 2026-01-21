let a,e,t,b,i,c;import"./buildingAnimation.f3f83e55.js";import"./buildingAnimation.4b8d4fc8.js";function r(a,e,t,b){Object.defineProperty(a,e,{get:t,set:b,enumerable:!0,configurable:!0})}var o=globalThis,l={},n={},s=o.parcelRequire1149;null==s&&((s=function(a){if(a in l)return l[a].exports;if(a in n){var e=n[a];delete n[a];var t={id:a,exports:{}};return l[a]=t,e.call(t.exports,t,t.exports),t.exports}var b=Error("Cannot find module '"+a+"'");throw b.code="MODULE_NOT_FOUND",b}).register=function(a,e){n[a]=e},o.parcelRequire1149=s);var d=s.register;d("82VHk",function(a,e){r(a.exports,"default",()=>b);var t=function(){var a=0,e=document.createElement("div");function b(a){return e.appendChild(a.dom),a}function i(t){for(var b=0;b<e.children.length;b++)e.children[b].style.display=b===t?"block":"none";a=t}e.style.cssText="position:fixed;top:0;left:0;cursor:pointer;opacity:0.9;z-index:10000",e.addEventListener("click",function(t){t.preventDefault(),i(++a%e.children.length)},!1);var c=(performance||Date).now(),r=c,o=0,l=b(new t.Panel("FPS","#0ff","#002")),n=b(new t.Panel("MS","#0f0","#020"));if(self.performance&&self.performance.memory)var s=b(new t.Panel("MB","#f08","#201"));return i(0),{REVISION:16,dom:e,addPanel:b,showPanel:i,begin:function(){c=(performance||Date).now()},end:function(){o++;var a=(performance||Date).now();if(n.update(a-c,200),a>=r+1e3&&(l.update(1e3*o/(a-r),100),r=a,o=0,s)){var e=performance.memory;s.update(e.usedJSHeapSize/1048576,e.jsHeapSizeLimit/1048576)}return a},update:function(){c=this.end()},domElement:e,setMode:i}};t.Panel=function(a,e,t){var b=1/0,i=0,c=Math.round,r=c(window.devicePixelRatio||1),o=80*r,l=48*r,n=3*r,s=2*r,d=3*r,p=15*r,h=74*r,f=30*r,g=document.createElement("canvas");g.width=o,g.height=l,g.style.cssText="width:80px;height:48px";var m=g.getContext("2d");return m.font="bold "+9*r+"px Helvetica,Arial,sans-serif",m.textBaseline="top",m.fillStyle=t,m.fillRect(0,0,o,l),m.fillStyle=e,m.fillText(a,n,s),m.fillRect(d,p,h,f),m.fillStyle=t,m.globalAlpha=.9,m.fillRect(d,p,h,f),{dom:g,update:function(l,u){b=Math.min(b,l),i=Math.max(i,l),m.fillStyle=t,m.globalAlpha=1,m.fillRect(0,0,o,p),m.fillStyle=e,m.fillText(c(l)+" "+a+" ("+c(b)+"-"+c(i)+")",n,s),m.drawImage(g,d+r,p,h-r,f,d,p,h-r,f),m.fillRect(d+h-r,p,r,f),m.fillStyle=t,m.globalAlpha=.9,m.fillRect(d+h-r,p,r,c((1-l/u)*f))}}};var b=t}),d("2Tb7o",function(a,e){r(a.exports,"getAssetURL",()=>t);function t(){let a;return"localhost"===window.location.hostname||"127.0.0.1"===window.location.hostname?"http://localhost:2000/":"https://wwjll.github.io/three-chamber/assets/"}});var p=s("jw0R5"),h=s("ihXk0"),p=s("jw0R5");class f extends p.DataTextureLoader{constructor(a){super(a),this.type=p.HalfFloatType}parse(a){let e,t,b,i=function(a,e){switch(a){case 1:throw Error("THREE.RGBELoader: Read Error: "+(e||""));case 2:throw Error("THREE.RGBELoader: Write Error: "+(e||""));case 3:throw Error("THREE.RGBELoader: Bad File Format: "+(e||""));default:throw Error("THREE.RGBELoader: Memory Error: "+(e||""))}},c=function(a,e,t){e=e||1024;let b=a.pos,i=-1,c=0,r="",o=String.fromCharCode.apply(null,new Uint16Array(a.subarray(b,b+128)));for(;0>(i=o.indexOf("\n"))&&c<e&&b<a.byteLength;)r+=o,c+=o.length,b+=128,o+=String.fromCharCode.apply(null,new Uint16Array(a.subarray(b,b+128)));return -1<i&&(!1!==t&&(a.pos+=c+i+1),r+o.slice(0,i))},r=new Uint8Array(a);r.pos=0;let o=function(a){let e,t,b=/^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,r=/^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,o=/^\s*FORMAT=(\S+)\s*$/,l=/^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,n={valid:0,string:"",comments:"",programtype:"RGBE",format:"",gamma:1,exposure:1,width:0,height:0};for(!(a.pos>=a.byteLength)&&(e=c(a))||i(1,"no header found"),(t=e.match(/^#\?(\S+)/))||i(3,"bad initial token"),n.valid|=1,n.programtype=t[1],n.string+=e+"\n";!1!==(e=c(a));){if(n.string+=e+"\n","#"===e.charAt(0)){n.comments+=e+"\n";continue}if((t=e.match(b))&&(n.gamma=parseFloat(t[1])),(t=e.match(r))&&(n.exposure=parseFloat(t[1])),(t=e.match(o))&&(n.valid|=2,n.format=t[1]),(t=e.match(l))&&(n.valid|=4,n.height=parseInt(t[1],10),n.width=parseInt(t[2],10)),2&n.valid&&4&n.valid)break}return 2&n.valid||i(3,"missing format specifier"),4&n.valid||i(3,"missing image size specifier"),n}(r),l=o.width,n=o.height,s=function(a,e,t){if(e<8||e>32767||2!==a[0]||2!==a[1]||128&a[2])return new Uint8Array(a);e!==(a[2]<<8|a[3])&&i(3,"wrong scanline width");let b=new Uint8Array(4*e*t);b.length||i(4,"unable to allocate buffer space");let c=0,r=0,o=4*e,l=new Uint8Array(4),n=new Uint8Array(o),s=t;for(;s>0&&r<a.byteLength;){r+4>a.byteLength&&i(1),l[0]=a[r++],l[1]=a[r++],l[2]=a[r++],l[3]=a[r++],(2!=l[0]||2!=l[1]||(l[2]<<8|l[3])!=e)&&i(3,"bad rgbe scanline format");let t=0,d;for(;t<o&&r<a.byteLength;){let e=(d=a[r++])>128;if(e&&(d-=128),(0===d||t+d>o)&&i(3,"bad scanline data"),e){let e=a[r++];for(let a=0;a<d;a++)n[t++]=e}else n.set(a.subarray(r,r+d),t),t+=d,r+=d}for(let a=0;a<e;a++){let t=0;b[c]=n[a+t],t+=e,b[c+1]=n[a+t],t+=e,b[c+2]=n[a+t],t+=e,b[c+3]=n[a+t],c+=4}s--}return b}(r.subarray(r.pos),l,n);switch(this.type){case p.FloatType:let d=new Float32Array(4*(b=s.length/4));for(let a=0;a<b;a++)!function(a,e,t,b){let i=Math.pow(2,a[e+3]-128)/255;t[b+0]=a[e+0]*i,t[b+1]=a[e+1]*i,t[b+2]=a[e+2]*i,t[b+3]=1}(s,4*a,d,4*a);e=d,t=p.FloatType;break;case p.HalfFloatType:let h=new Uint16Array(4*(b=s.length/4));for(let a=0;a<b;a++)!function(a,e,t,b){let i=Math.pow(2,a[e+3]-128)/255;t[b+0]=(0,p.DataUtils).toHalfFloat(Math.min(a[e+0]*i,65504)),t[b+1]=(0,p.DataUtils).toHalfFloat(Math.min(a[e+1]*i,65504)),t[b+2]=(0,p.DataUtils).toHalfFloat(Math.min(a[e+2]*i,65504)),t[b+3]=(0,p.DataUtils).toHalfFloat(1)}(s,4*a,h,4*a);e=h,t=p.HalfFloatType;break;default:throw Error("THREE.RGBELoader: Unsupported type: "+this.type)}return{width:l,height:n,data:e,header:o.string,gamma:o.gamma,exposure:o.exposure,type:t}}setDataType(a){return this.type=a,this}load(a,e,t,b){return super.load(a,function(a,t){switch(a.type){case p.FloatType:case p.HalfFloatType:a.colorSpace=p.LinearSRGBColorSpace,a.minFilter=p.LinearFilter,a.magFilter=p.LinearFilter,a.generateMipmaps=!1,a.flipY=!0}e&&e(a,t)},t,b)}}var g=s("2sw9m"),m=s("82VHk"),u=function(){var a,e=new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,3,2,0,0,5,3,1,0,1,12,1,0,10,22,2,12,0,65,0,65,0,65,0,252,10,0,0,11,7,0,65,0,253,15,26,11]),t=new Uint8Array([32,0,65,2,1,106,34,33,3,128,11,4,13,64,6,253,10,7,15,116,127,5,8,12,40,16,19,54,20,9,27,255,113,17,42,67,24,23,146,148,18,14,22,45,70,69,56,114,101,21,25,63,75,136,108,28,118,29,73,115]);if("object"!=typeof WebAssembly)return{supported:!1};var b=WebAssembly.validate(e)?"b9H79TebbbeKl9Gbb9Gvuuuuueu9Giuuub9Geueuikqbbebeedddilve9Weeeviebeoweuec:q;Aekr;leDo9TW9T9VV95dbH9F9F939H79T9F9J9H229F9Jt9VV7bb8A9TW79O9V9Wt9F9KW9J9V9KW9wWVtW949c919M9MWVbdY9TW79O9V9Wt9F9KW9J9V9KW69U9KW949c919M9MWVblE9TW79O9V9Wt9F9KW9J9V9KW69U9KW949tWG91W9U9JWbvL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9p9JtboK9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9r919HtbrL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVT949Wbwl79IV9RbDq;t9tqlbzik9:evu8Jjjjjbcz9Rhbcbheincbhdcbhiinabcwfadfaicjuaead4ceGglE86bbaialfhiadcefgdcw9hmbkaec:q:yjjbfai86bbaecitc:q1jjbfab8Piw83ibaecefgecjd9hmbkk;h8JlHud97euo978Jjjjjbcj;kb9Rgv8Kjjjjbc9:hodnadcefal0mbcuhoaiRbbc:Ge9hmbavaialfgrad9Rad;8qbbcj;abad9UhoaicefhldnadTmbaoc;WFbGgocjdaocjd6EhwcbhDinaDae9pmeawaeaD9RaDawfae6Egqcsfgoc9WGgkci2hxakcethmaocl4cifcd4hPabaDad2fhscbhzdnincehHalhOcbhAdninaraO9RaP6miavcj;cbfaAak2fhCaOaPfhlcbhidnakc;ab6mbaral9Rc;Gb6mbcbhoinaCaofhidndndndndnaOaoco4fRbbgXciGPlbedibkaipxbbbbbbbbbbbbbbbbpklbxikaialpbblalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLgQcdp:meaQpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogLpxiiiiiiiiiiiiiiiip8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibaKc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spklbalclfaYpQbfaKc:q:yjjbfRbbfhlxdkaialpbbwalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogLpxssssssssssssssssp8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibaKc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spklbalcwfaYpQbfaKc:q:yjjbfRbbfhlxekaialpbbbpklbalczfhlkdndndndndnaXcd4ciGPlbedibkaipxbbbbbbbbbbbbbbbbpklzxikaialpbblalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLgQcdp:meaQpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogLpxiiiiiiiiiiiiiiiip8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibaKc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spklzalclfaYpQbfaKc:q:yjjbfRbbfhlxdkaialpbbwalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogLpxssssssssssssssssp8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibaKc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spklzalcwfaYpQbfaKc:q:yjjbfRbbfhlxekaialpbbbpklzalczfhlkdndndndndnaXcl4ciGPlbedibkaipxbbbbbbbbbbbbbbbbpklaxikaialpbblalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLgQcdp:meaQpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogLpxiiiiiiiiiiiiiiiip8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibaKc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spklaalclfaYpQbfaKc:q:yjjbfRbbfhlxdkaialpbbwalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogLpxssssssssssssssssp8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibaKc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spklaalcwfaYpQbfaKc:q:yjjbfRbbfhlxekaialpbbbpklaalczfhlkdndndndndnaXco4Plbedibkaipxbbbbbbbbbbbbbbbbpkl8WxikaialpbblalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLgQcdp:meaQpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogLpxiiiiiiiiiiiiiiiip8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgXcitc:q1jjbfpbibaXc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgXcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spkl8WalclfaYpQbfaXc:q:yjjbfRbbfhlxdkaialpbbwalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogLpxssssssssssssssssp8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgXcitc:q1jjbfpbibaXc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgXcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spkl8WalcwfaYpQbfaXc:q:yjjbfRbbfhlxekaialpbbbpkl8Walczfhlkaoc;abfhiaocjefak0meaihoaral9Rc;Fb0mbkkdndnaiak9pmbaici4hoinaral9RcK6mdaCaifhXdndndndndnaOaico4fRbbaocoG4ciGPlbedibkaXpxbbbbbbbbbbbbbbbbpklbxikaXalpbblalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLgQcdp:meaQpmbzeHdOiAlCvXoQrLpxiiiiiiiiiiiiiiiip9ogLpxiiiiiiiiiiiiiiiip8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibaKc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spklbalclfaYpQbfaKc:q:yjjbfRbbfhlxdkaXalpbbwalpbbbgQclp:meaQpmbzeHdOiAlCvXoQrLpxssssssssssssssssp9ogLpxssssssssssssssssp8JgQp5b9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibaKc:q:yjjbfpbbbgYaYpmbbbbbbbbbbbbbbbbaQp5e9cjF;8;4;W;G;ab9:9cU1:NgKcitc:q1jjbfpbibp9UpmbedilvorzHOACXQLpPaLaQp9spklbalcwfaYpQbfaKc:q:yjjbfRbbfhlxekaXalpbbbpklbalczfhlkaocdfhoaiczfgiak6mbkkalTmbaAci6hHalhOaAcefgohAaoclSmdxekkcbhlaHceGmdkdnakTmbavcjdfazfhiavazfpbdbhYcbhXinaiavcj;cbfaXfgopblbgLcep9TaLpxeeeeeeeeeeeeeeeegQp9op9Hp9rgLaoakfpblbg8Acep9Ta8AaQp9op9Hp9rg8ApmbzeHdOiAlCvXoQrLgEaoamfpblbg3cep9Ta3aQp9op9Hp9rg3aoaxfpblbg5cep9Ta5aQp9op9Hp9rg5pmbzeHdOiAlCvXoQrLg8EpmbezHdiOAlvCXorQLgQaQpmbedibedibedibediaYp9UgYp9AdbbaiadfgoaYaQaQpmlvorlvorlvorlvorp9UgYp9AdbbaoadfgoaYaQaQpmwDqkwDqkwDqkwDqkp9UgYp9AdbbaoadfgoaYaQaQpmxmPsxmPsxmPsxmPsp9UgYp9AdbbaoadfgoaYaEa8EpmwDKYqk8AExm35Ps8E8FgQaQpmbedibedibedibedip9UgYp9AdbbaoadfgoaYaQaQpmlvorlvorlvorlvorp9UgYp9AdbbaoadfgoaYaQaQpmwDqkwDqkwDqkwDqkp9UgYp9AdbbaoadfgoaYaQaQpmxmPsxmPsxmPsxmPsp9UgYp9AdbbaoadfgoaYaLa8ApmwKDYq8AkEx3m5P8Es8FgLa3a5pmwKDYq8AkEx3m5P8Es8Fg8ApmbezHdiOAlvCXorQLgQaQpmbedibedibedibedip9UgYp9AdbbaoadfgoaYaQaQpmlvorlvorlvorlvorp9UgYp9AdbbaoadfgoaYaQaQpmwDqkwDqkwDqkwDqkp9UgYp9AdbbaoadfgoaYaQaQpmxmPsxmPsxmPsxmPsp9UgYp9AdbbaoadfgoaYaLa8ApmwDKYqk8AExm35Ps8E8FgQaQpmbedibedibedibedip9UgYp9AdbbaoadfgoaYaQaQpmlvorlvorlvorlvorp9UgYp9AdbbaoadfgoaYaQaQpmwDqkwDqkwDqkwDqkp9UgYp9AdbbaoadfgoaYaQaQpmxmPsxmPsxmPsxmPsp9UgYp9AdbbaoadfhiaXczfgXak6mbkkazclfgzad6mbkasavcjdfaqad2;8qbbavavcjdfaqcufad2fad;8qbbaqaDfhDc9:hoalmexikkc9:hoxekcbc99aral9Radcaadca0ESEhokavcj;kbf8Kjjjjbaokwbz:bjjjbk;uzeHu8Jjjjjbc;ae9Rgv8Kjjjjbc9:hodnaeci9UgrcHfal0mbcuhoaiRbbgwc;WeGc;Ge9hmbawcsGgDce0mbavc;abfcFecje;8kbavcUf9cu83ibavc8Wf9cu83ibavcyf9cu83ibavcaf9cu83ibavcKf9cu83ibavczf9cu83ibav9cu83iwav9cu83ibaialfc9WfhqaicefgwarfhodnaeTmbcmcsaDceSEhkcbhxcbhmcbhDcbhicbhlindnaoaq9nmbc9:hoxikdndnawRbbgrc;Ve0mbavc;abfalarcl4cu7fcsGcitfgPydlhsaPydbhzdnarcsGgPak9pmbavaiarcu7fcsGcdtfydbaxaPEhraPThPdndnadcd9hmbabaDcetfgHaz87ebaHcdfas87ebaHclfar87ebxekabaDcdtfgHazBdbaHclfasBdbaHcwfarBdbkaxaPfhxavc;abfalcitfgHarBdbaHasBdlavaicdtfarBdbavc;abfalcefcsGglcitfgHazBdbaHarBdlaiaPfhialcefhlxdkdndnaPcsSmbamaPfaPc987fcefhmxekaocefhrao8SbbgPcFeGhHdndnaPcu9mmbarhoxekaocvfhoaHcFbGhHcrhPdninar8SbbgOcFbGaPtaHVhHaOcu9kmearcefhraPcrfgPc8J9hmbxdkkarcefhokaHce4cbaHceG9R7amfhmkdndnadcd9hmbabaDcetfgraz87ebarcdfas87ebarclfam87ebxekabaDcdtfgrazBdbarclfasBdbarcwfamBdbkavc;abfalcitfgramBdbarasBdlavaicdtfamBdbavc;abfalcefcsGglcitfgrazBdbaramBdlaicefhialcefhlxekdnarcpe0mbaxcefgOavaiaqarcsGfRbbgPcl49RcsGcdtfydbaPcz6gHEhravaiaP9RcsGcdtfydbaOaHfgsaPcsGgOEhPaOThOdndnadcd9hmbabaDcetfgzax87ebazcdfar87ebazclfaP87ebxekabaDcdtfgzaxBdbazclfarBdbazcwfaPBdbkavaicdtfaxBdbavc;abfalcitfgzarBdbazaxBdlavaicefgicsGcdtfarBdbavc;abfalcefcsGcitfgzaPBdbazarBdlavaiaHfcsGgicdtfaPBdbavc;abfalcdfcsGglcitfgraxBdbaraPBdlalcefhlaiaOfhiasaOfhxxekaxcbaoRbbgzEgAarc;:eSgrfhsazcsGhCazcl4hXdndnazcs0mbascefhOxekashOavaiaX9RcsGcdtfydbhskdndnaCmbaOcefhxxekaOhxavaiaz9RcsGcdtfydbhOkdndnarTmbaocefhrxekaocdfhrao8SbegHcFeGhPdnaHcu9kmbaocofhAaPcFbGhPcrhodninar8SbbgHcFbGaotaPVhPaHcu9kmearcefhraocrfgoc8J9hmbkaAhrxekarcefhrkaPce4cbaPceG9R7amfgmhAkdndnaXcsSmbarhPxekarcefhPar8SbbgocFeGhHdnaocu9kmbarcvfhsaHcFbGhHcrhodninaP8SbbgrcFbGaotaHVhHarcu9kmeaPcefhPaocrfgoc8J9hmbkashPxekaPcefhPkaHce4cbaHceG9R7amfgmhskdndnaCcsSmbaPhoxekaPcefhoaP8SbbgrcFeGhHdnarcu9kmbaPcvfhOaHcFbGhHcrhrdninao8SbbgPcFbGartaHVhHaPcu9kmeaocefhoarcrfgrc8J9hmbkaOhoxekaocefhokaHce4cbaHceG9R7amfgmhOkdndnadcd9hmbabaDcetfgraA87ebarcdfas87ebarclfaO87ebxekabaDcdtfgraABdbarclfasBdbarcwfaOBdbkavc;abfalcitfgrasBdbaraABdlavaicdtfaABdbavc;abfalcefcsGcitfgraOBdbarasBdlavaicefgicsGcdtfasBdbavc;abfalcdfcsGcitfgraABdbaraOBdlavaiazcz6aXcsSVfgicsGcdtfaOBdbaiaCTaCcsSVfhialcifhlkawcefhwalcsGhlaicsGhiaDcifgDae6mbkkcbc99aoaqSEhokavc;aef8Kjjjjbaok:llevu8Jjjjjbcz9Rhvc9:hodnaecvfal0mbcuhoaiRbbc;:eGc;qe9hmbav9cb83iwaicefhraialfc98fhwdnaeTmbdnadcdSmbcbhDindnaraw6mbc9:skarcefhoar8SbbglcFeGhidndnalcu9mmbaohrxekarcvfhraicFbGhicrhldninao8SbbgdcFbGaltaiVhiadcu9kmeaocefhoalcrfglc8J9hmbxdkkaocefhrkabaDcdtfaicd4cbaice4ceG9R7avcwfaiceGcdtVgoydbfglBdbaoalBdbaDcefgDae9hmbxdkkcbhDindnaraw6mbc9:skarcefhoar8SbbglcFeGhidndnalcu9mmbaohrxekarcvfhraicFbGhicrhldninao8SbbgdcFbGaltaiVhiadcu9kmeaocefhoalcrfglc8J9hmbxdkkaocefhrkabaDcetfaicd4cbaice4ceG9R7avcwfaiceGcdtVgoydbfgl87ebaoalBdbaDcefgDae9hmbkkcbc99arawSEhokaok:EPliuo97eue978Jjjjjbca9Rhidndnadcl9hmbdnaec98GglTmbcbhvabhdinadadpbbbgocKp:RecKp:Sep;6egraocwp:RecKp:Sep;6earp;Geaoczp:RecKp:Sep;6egwp;Gep;Kep;LegDpxbbbbbbbbbbbbbbbbp:2egqarpxbbbjbbbjbbbjbbbjgkp9op9rp;Kegrpxbb;:9cbb;:9cbb;:9cbb;:9cararp;MeaDaDp;Meawaqawakp9op9rp;Kegrarp;Mep;Kep;Kep;Jep;Negwp;Mepxbbn0bbn0bbn0bbn0gqp;KepxFbbbFbbbFbbbFbbbp9oaopxbbbFbbbFbbbFbbbFp9op9qarawp;Meaqp;Kecwp:RepxbFbbbFbbbFbbbFbbp9op9qaDawp;Meaqp;Keczp:RepxbbFbbbFbbbFbbbFbp9op9qpkbbadczfhdavclfgval6mbkkalae9pmeaiaeciGgvcdtgdVcbczad9R;8kbaiabalcdtfglad;8qbbdnavTmbaiaipblbgocKp:RecKp:Sep;6egraocwp:RecKp:Sep;6earp;Geaoczp:RecKp:Sep;6egwp;Gep;Kep;LegDpxbbbbbbbbbbbbbbbbp:2egqarpxbbbjbbbjbbbjbbbjgkp9op9rp;Kegrpxbb;:9cbb;:9cbb;:9cbb;:9cararp;MeaDaDp;Meawaqawakp9op9rp;Kegrarp;Mep;Kep;Kep;Jep;Negwp;Mepxbbn0bbn0bbn0bbn0gqp;KepxFbbbFbbbFbbbFbbbp9oaopxbbbFbbbFbbbFbbbFp9op9qarawp;Meaqp;Kecwp:RepxbFbbbFbbbFbbbFbbp9op9qaDawp;Meaqp;Keczp:RepxbbFbbbFbbbFbbbFbp9op9qpklbkalaiad;8qbbskdnaec98GgxTmbcbhvabhdinadczfglalpbbbgopxbbbbbbFFbbbbbbFFgkp9oadpbbbgDaopmlvorxmPsCXQL358E8FpxFubbFubbFubbFubbp9op;6eaDaopmbediwDqkzHOAKY8AEgoczp:Sep;6egrp;Geaoczp:Reczp:Sep;6egwp;Gep;Kep;Legopxb;:FSb;:FSb;:FSb;:FSawaopxbbbbbbbbbbbbbbbbp:2egqawpxbbbjbbbjbbbjbbbjgmp9op9rp;Kegwawp;Meaoaop;Mearaqaramp9op9rp;Kegoaop;Mep;Kep;Kep;Jep;Negrp;Mepxbbn0bbn0bbn0bbn0gqp;Keczp:Reawarp;Meaqp;KepxFFbbFFbbFFbbFFbbp9op9qgwaoarp;Meaqp;KepxFFbbFFbbFFbbFFbbp9ogopmwDKYqk8AExm35Ps8E8Fp9qpkbbadaDakp9oawaopmbezHdiOAlvCXorQLp9qpkbbadcafhdavclfgvax6mbkkaxae9pmbaiaeciGgvcitgdfcbcaad9R;8kbaiabaxcitfglad;8qbbdnavTmbaiaipblzgopxbbbbbbFFbbbbbbFFgkp9oaipblbgDaopmlvorxmPsCXQL358E8FpxFubbFubbFubbFubbp9op;6eaDaopmbediwDqkzHOAKY8AEgoczp:Sep;6egrp;Geaoczp:Reczp:Sep;6egwp;Gep;Kep;Legopxb;:FSb;:FSb;:FSb;:FSawaopxbbbbbbbbbbbbbbbbp:2egqawpxbbbjbbbjbbbjbbbjgmp9op9rp;Kegwawp;Meaoaop;Mearaqaramp9op9rp;Kegoaop;Mep;Kep;Kep;Jep;Negrp;Mepxbbn0bbn0bbn0bbn0gqp;Keczp:Reawarp;Meaqp;KepxFFbbFFbbFFbbFFbbp9op9qgwaoarp;Meaqp;KepxFFbbFFbbFFbbFFbbp9ogopmwDKYqk8AExm35Ps8E8Fp9qpklzaiaDakp9oawaopmbezHdiOAlvCXorQLp9qpklbkalaiad;8qbbkk;4wllue97euv978Jjjjjbc8W9Rhidnaec98GglTmbcbhvabhoinaiaopbbbgraoczfgwpbbbgDpmlvorxmPsCXQL358E8Fgqczp:Segkclp:RepklbaopxbbjZbbjZbbjZbbjZpx;Zl81Z;Zl81Z;Zl81Z;Zl81Zakpxibbbibbbibbbibbbp9qp;6ep;NegkaraDpmbediwDqkzHOAKY8AEgrczp:Reczp:Sep;6ep;MegDaDp;Meakarczp:Sep;6ep;Megxaxp;Meakaqczp:Reczp:Sep;6ep;Megqaqp;Mep;Kep;Kep;Lepxbbbbbbbbbbbbbbbbp:4ep;Jepxb;:FSb;:FSb;:FSb;:FSgkp;Mepxbbn0bbn0bbn0bbn0grp;KepxFFbbFFbbFFbbFFbbgmp9oaxakp;Mearp;Keczp:Rep9qgxaqakp;Mearp;Keczp:ReaDakp;Mearp;Keamp9op9qgkpmbezHdiOAlvCXorQLgrp5baipblbpEb:T:j83ibaocwfarp5eaipblbpEe:T:j83ibawaxakpmwDKYqk8AExm35Ps8E8Fgkp5baipblbpEd:T:j83ibaocKfakp5eaipblbpEi:T:j83ibaocafhoavclfgval6mbkkdnalae9pmbaiaeciGgvcitgofcbcaao9R;8kbaiabalcitfgwao;8qbbdnavTmbaiaipblbgraipblzgDpmlvorxmPsCXQL358E8Fgqczp:Segkclp:RepklaaipxbbjZbbjZbbjZbbjZpx;Zl81Z;Zl81Z;Zl81Z;Zl81Zakpxibbbibbbibbbibbbp9qp;6ep;NegkaraDpmbediwDqkzHOAKY8AEgrczp:Reczp:Sep;6ep;MegDaDp;Meakarczp:Sep;6ep;Megxaxp;Meakaqczp:Reczp:Sep;6ep;Megqaqp;Mep;Kep;Kep;Lepxbbbbbbbbbbbbbbbbp:4ep;Jepxb;:FSb;:FSb;:FSb;:FSgkp;Mepxbbn0bbn0bbn0bbn0grp;KepxFFbbFFbbFFbbFFbbgmp9oaxakp;Mearp;Keczp:Rep9qgxaqakp;Mearp;Keczp:ReaDakp;Mearp;Keamp9op9qgkpmbezHdiOAlvCXorQLgrp5baipblapEb:T:j83ibaiarp5eaipblapEe:T:j83iwaiaxakpmwDKYqk8AExm35Ps8E8Fgkp5baipblapEd:T:j83izaiakp5eaipblapEi:T:j83iKkawaiao;8qbbkk:Pddiue978Jjjjjbc;ab9Rhidnadcd4ae2glc98GgvTmbcbhdabheinaeaepbbbgocwp:Recwp:Sep;6eaocep:SepxbbjZbbjZbbjZbbjZp:UepxbbjFbbjFbbjFbbjFp9op;Mepkbbaeczfheadclfgdav6mbkkdnaval9pmbaialciGgdcdtgeVcbc;abae9R;8kbaiabavcdtfgvae;8qbbdnadTmbaiaipblbgocwp:Recwp:Sep;6eaocep:SepxbbjZbbjZbbjZbbjZp:UepxbbjFbbjFbbjFbbjFp9op;Mepklbkavaiae;8qbbkk9teiucbcbydj1jjbgeabcifc98GfgbBdj1jjbdndnabZbcztgd9nmbcuhiabad9RcFFifcz4nbcuSmekaehikaikkkebcjwklz9Tbb":"b9H79Tebbbe8Fv9Gbb9Gvuuuuueu9Giuuub9Geueu9Giuuueuikqbeeedddillviebeoweuec:q;iekr;leDo9TW9T9VV95dbH9F9F939H79T9F9J9H229F9Jt9VV7bb8A9TW79O9V9Wt9F9KW9J9V9KW9wWVtW949c919M9MWVbeY9TW79O9V9Wt9F9KW9J9V9KW69U9KW949c919M9MWVbdE9TW79O9V9Wt9F9KW9J9V9KW69U9KW949tWG91W9U9JWbiL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9p9JtblK9TW79O9V9Wt9F9KW9J9V9KWS9P2tWV9r919HtbvL9TW79O9V9Wt9F9KW9J9V9KWS9P2tWVT949Wbol79IV9Rbrq:P8Yqdbk;3sezu8Jjjjjbcj;eb9Rgv8Kjjjjbc9:hodnadcefal0mbcuhoaiRbbc:Ge9hmbavaialfgrad9Radz1jjjbhwcj;abad9UhoaicefhldnadTmbaoc;WFbGgocjdaocjd6EhDcbhqinaqae9pmeaDaeaq9RaqaDfae6Egkcsfgocl4cifcd4hxdndndndnaoc9WGgmTmbcbhPcehsawcjdfhzalhHinaraH9Rax6midnaraHaxfgl9RcK6mbczhoinawcj;cbfaogifgoc9WfhOdndndndndnaHaic9WfgAco4fRbbaAci4coG4ciGPlbedibkaO9cb83ibaOcwf9cb83ibxikaOalRblalRbbgAco4gCaCciSgCE86bbaocGfalclfaCfgORbbaAcl4ciGgCaCciSgCE86bbaocVfaOaCfgORbbaAcd4ciGgCaCciSgCE86bbaoc7faOaCfgORbbaAciGgAaAciSgAE86bbaoctfaOaAfgARbbalRbegOco4gCaCciSgCE86bbaoc91faAaCfgARbbaOcl4ciGgCaCciSgCE86bbaoc4faAaCfgARbbaOcd4ciGgCaCciSgCE86bbaoc93faAaCfgARbbaOciGgOaOciSgOE86bbaoc94faAaOfgARbbalRbdgOco4gCaCciSgCE86bbaoc95faAaCfgARbbaOcl4ciGgCaCciSgCE86bbaoc96faAaCfgARbbaOcd4ciGgCaCciSgCE86bbaoc97faAaCfgARbbaOciGgOaOciSgOE86bbaoc98faAaOfgORbbalRbiglco4gAaAciSgAE86bbaoc99faOaAfgORbbalcl4ciGgAaAciSgAE86bbaoc9:faOaAfgORbbalcd4ciGgAaAciSgAE86bbaocufaOaAfgoRbbalciGglalciSglE86bbaoalfhlxdkaOalRbwalRbbgAcl4gCaCcsSgCE86bbaocGfalcwfaCfgORbbaAcsGgAaAcsSgAE86bbaocVfaOaAfgORbbalRbegAcl4gCaCcsSgCE86bbaoc7faOaCfgORbbaAcsGgAaAcsSgAE86bbaoctfaOaAfgORbbalRbdgAcl4gCaCcsSgCE86bbaoc91faOaCfgORbbaAcsGgAaAcsSgAE86bbaoc4faOaAfgORbbalRbigAcl4gCaCcsSgCE86bbaoc93faOaCfgORbbaAcsGgAaAcsSgAE86bbaoc94faOaAfgORbbalRblgAcl4gCaCcsSgCE86bbaoc95faOaCfgORbbaAcsGgAaAcsSgAE86bbaoc96faOaAfgORbbalRbvgAcl4gCaCcsSgCE86bbaoc97faOaCfgORbbaAcsGgAaAcsSgAE86bbaoc98faOaAfgORbbalRbogAcl4gCaCcsSgCE86bbaoc99faOaCfgORbbaAcsGgAaAcsSgAE86bbaoc9:faOaAfgORbbalRbrglcl4gAaAcsSgAE86bbaocufaOaAfgoRbbalcsGglalcsSglE86bbaoalfhlxekaOal8Pbb83bbaOcwfalcwf8Pbb83bbalczfhlkdnaiam9pmbaiczfhoaral9RcL0mekkaiam6mialTmidnakTmbawaPfRbbhOcbhoazhiinaiawcj;cbfaofRbbgAce4cbaAceG9R7aOfgO86bbaiadfhiaocefgoak9hmbkkazcefhzaPcefgPad6hsalhHaPad9hmexvkkcbhlasceGmdxikalaxad2fhCdnakTmbcbhHcehsawcjdfhminaral9Rax6mialTmdalaxfhlawaHfRbbhOcbhoamhiinaiawcj;cbfaofRbbgAce4cbaAceG9R7aOfgO86bbaiadfhiaocefgoak9hmbkamcefhmaHcefgHad6hsaHad9hmbkaChlxikcbhocehsinaral9Rax6mdalTmealaxfhlaocefgoad6hsadao9hmbkaChlxdkcbhlasceGTmekc9:hoxikabaqad2fawcjdfakad2z1jjjb8Aawawcjdfakcufad2fadz1jjjb8Aakaqfhqalmbkc9:hoxekcbc99aral9Radcaadca0ESEhokavcj;ebf8Kjjjjbaok;yzeHu8Jjjjjbc;ae9Rgv8Kjjjjbc9:hodnaeci9UgrcHfal0mbcuhoaiRbbgwc;WeGc;Ge9hmbawcsGgDce0mbavc;abfcFecjez:jjjjb8AavcUf9cu83ibavc8Wf9cu83ibavcyf9cu83ibavcaf9cu83ibavcKf9cu83ibavczf9cu83ibav9cu83iwav9cu83ibaialfc9WfhqaicefgwarfhodnaeTmbcmcsaDceSEhkcbhxcbhmcbhDcbhicbhlindnaoaq9nmbc9:hoxikdndnawRbbgrc;Ve0mbavc;abfalarcl4cu7fcsGcitfgPydlhsaPydbhzdnarcsGgPak9pmbavaiarcu7fcsGcdtfydbaxaPEhraPThPdndnadcd9hmbabaDcetfgHaz87ebaHcdfas87ebaHclfar87ebxekabaDcdtfgHazBdbaHclfasBdbaHcwfarBdbkaxaPfhxavc;abfalcitfgHarBdbaHasBdlavaicdtfarBdbavc;abfalcefcsGglcitfgHazBdbaHarBdlaiaPfhialcefhlxdkdndnaPcsSmbamaPfaPc987fcefhmxekaocefhrao8SbbgPcFeGhHdndnaPcu9mmbarhoxekaocvfhoaHcFbGhHcrhPdninar8SbbgOcFbGaPtaHVhHaOcu9kmearcefhraPcrfgPc8J9hmbxdkkarcefhokaHce4cbaHceG9R7amfhmkdndnadcd9hmbabaDcetfgraz87ebarcdfas87ebarclfam87ebxekabaDcdtfgrazBdbarclfasBdbarcwfamBdbkavc;abfalcitfgramBdbarasBdlavaicdtfamBdbavc;abfalcefcsGglcitfgrazBdbaramBdlaicefhialcefhlxekdnarcpe0mbaxcefgOavaiaqarcsGfRbbgPcl49RcsGcdtfydbaPcz6gHEhravaiaP9RcsGcdtfydbaOaHfgsaPcsGgOEhPaOThOdndnadcd9hmbabaDcetfgzax87ebazcdfar87ebazclfaP87ebxekabaDcdtfgzaxBdbazclfarBdbazcwfaPBdbkavaicdtfaxBdbavc;abfalcitfgzarBdbazaxBdlavaicefgicsGcdtfarBdbavc;abfalcefcsGcitfgzaPBdbazarBdlavaiaHfcsGgicdtfaPBdbavc;abfalcdfcsGglcitfgraxBdbaraPBdlalcefhlaiaOfhiasaOfhxxekaxcbaoRbbgzEgAarc;:eSgrfhsazcsGhCazcl4hXdndnazcs0mbascefhOxekashOavaiaX9RcsGcdtfydbhskdndnaCmbaOcefhxxekaOhxavaiaz9RcsGcdtfydbhOkdndnarTmbaocefhrxekaocdfhrao8SbegHcFeGhPdnaHcu9kmbaocofhAaPcFbGhPcrhodninar8SbbgHcFbGaotaPVhPaHcu9kmearcefhraocrfgoc8J9hmbkaAhrxekarcefhrkaPce4cbaPceG9R7amfgmhAkdndnaXcsSmbarhPxekarcefhPar8SbbgocFeGhHdnaocu9kmbarcvfhsaHcFbGhHcrhodninaP8SbbgrcFbGaotaHVhHarcu9kmeaPcefhPaocrfgoc8J9hmbkashPxekaPcefhPkaHce4cbaHceG9R7amfgmhskdndnaCcsSmbaPhoxekaPcefhoaP8SbbgrcFeGhHdnarcu9kmbaPcvfhOaHcFbGhHcrhrdninao8SbbgPcFbGartaHVhHaPcu9kmeaocefhoarcrfgrc8J9hmbkaOhoxekaocefhokaHce4cbaHceG9R7amfgmhOkdndnadcd9hmbabaDcetfgraA87ebarcdfas87ebarclfaO87ebxekabaDcdtfgraABdbarclfasBdbarcwfaOBdbkavc;abfalcitfgrasBdbaraABdlavaicdtfaABdbavc;abfalcefcsGcitfgraOBdbarasBdlavaicefgicsGcdtfasBdbavc;abfalcdfcsGcitfgraABdbaraOBdlavaiazcz6aXcsSVfgicsGcdtfaOBdbaiaCTaCcsSVfhialcifhlkawcefhwalcsGhlaicsGhiaDcifgDae6mbkkcbc99aoaqSEhokavc;aef8Kjjjjbaok:llevu8Jjjjjbcz9Rhvc9:hodnaecvfal0mbcuhoaiRbbc;:eGc;qe9hmbav9cb83iwaicefhraialfc98fhwdnaeTmbdnadcdSmbcbhDindnaraw6mbc9:skarcefhoar8SbbglcFeGhidndnalcu9mmbaohrxekarcvfhraicFbGhicrhldninao8SbbgdcFbGaltaiVhiadcu9kmeaocefhoalcrfglc8J9hmbxdkkaocefhrkabaDcdtfaicd4cbaice4ceG9R7avcwfaiceGcdtVgoydbfglBdbaoalBdbaDcefgDae9hmbxdkkcbhDindnaraw6mbc9:skarcefhoar8SbbglcFeGhidndnalcu9mmbaohrxekarcvfhraicFbGhicrhldninao8SbbgdcFbGaltaiVhiadcu9kmeaocefhoalcrfglc8J9hmbxdkkaocefhrkabaDcetfaicd4cbaice4ceG9R7avcwfaiceGcdtVgoydbfgl87ebaoalBdbaDcefgDae9hmbkkcbc99arawSEhokaok:Lvoeue99dud99eud99dndnadcl9hmbaeTmeindndnabcdfgd8Sbb:Yab8Sbbgi:Ygl:l:tabcefgv8Sbbgo:Ygr:l:tgwJbb;:9cawawNJbbbbawawJbbbb9GgDEgq:mgkaqaicb9iEalMgwawNakaqaocb9iEarMgqaqNMM:r:vglNJbbbZJbbb:;aDEMgr:lJbbb9p9DTmbar:Ohixekcjjjj94hikadai86bbdndnaqalNJbbbZJbbb:;aqJbbbb9GEMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkavad86bbdndnawalNJbbbZJbbb:;awJbbbb9GEMgw:lJbbb9p9DTmbaw:Ohdxekcjjjj94hdkabad86bbabclfhbaecufgembxdkkaeTmbindndnabclfgd8Ueb:Yab8Uebgi:Ygl:l:tabcdfgv8Uebgo:Ygr:l:tgwJb;:FSawawNJbbbbawawJbbbb9GgDEgq:mgkaqaicb9iEalMgwawNakaqaocb9iEarMgqaqNMM:r:vglNJbbbZJbbb:;aDEMgr:lJbbb9p9DTmbar:Ohixekcjjjj94hikadai87ebdndnaqalNJbbbZJbbb:;aqJbbbb9GEMgq:lJbbb9p9DTmbaq:Ohdxekcjjjj94hdkavad87ebdndnawalNJbbbZJbbb:;awJbbbb9GEMgw:lJbbb9p9DTmbaw:Ohdxekcjjjj94hdkabad87ebabcwfhbaecufgembkkk;siliui99iue99dnaeTmbcbhiabhlindndnJ;Zl81Zalcof8UebgvciV:Y:vgoal8Ueb:YNgrJb;:FSNJbbbZJbbb:;arJbbbb9GEMgw:lJbbb9p9DTmbaw:OhDxekcjjjj94hDkalclf8Uebhqalcdf8UebhkabavcefciGaiVcetfaD87ebdndnaoak:YNgwJb;:FSNJbbbZJbbb:;awJbbbb9GEMgx:lJbbb9p9DTmbax:Ohkxekcjjjj94hkkabavcdfciGaiVcetfak87ebdndnaoaq:YNgoJb;:FSNJbbbZJbbb:;aoJbbbb9GEMgx:lJbbb9p9DTmbax:Ohqxekcjjjj94hqkabavcufciGaiVcetfaq87ebdndnJbbjZararN:tawawN:taoaoN:tgrJbbbbarJbbbb9GE:rJb;:FSNJbbbZMgr:lJbbb9p9DTmbar:Ohqxekcjjjj94hqkabavciGaiVcetfaq87ebalcwfhlaiclfhiaecufgembkkk9mbdnadcd4ae2geTmbinababydbgdcwtcw91:Yadce91cjjj;8ifcjjj98G::NUdbabclfhbaecufgembkkk9teiucbcbydj1jjbgeabcifc98GfgbBdj1jjbdndnabZbcztgd9nmbcuhiabad9RcFFifcz4nbcuSmekaehikaik;LeeeudndnaeabVciGTmbabhixekdndnadcz9pmbabhixekabhiinaiaeydbBdbaiclfaeclfydbBdbaicwfaecwfydbBdbaicxfaecxfydbBdbaiczfhiaeczfheadc9Wfgdcs0mbkkadcl6mbinaiaeydbBdbaeclfheaiclfhiadc98fgdci0mbkkdnadTmbinaiaeRbb86bbaicefhiaecefheadcufgdmbkkabk;aeedudndnabciGTmbabhixekaecFeGc:b:c:ew2hldndnadcz9pmbabhixekabhiinaialBdbaicxfalBdbaicwfalBdbaiclfalBdbaiczfhiadc9Wfgdcs0mbkkadcl6mbinaialBdbaiclfhiadc98fgdci0mbkkdnadTmbinaiae86bbaicefhiadcufgdmbkkabkkkebcjwklz9Kbb",i=WebAssembly.instantiate(c(b),{}).then(function(e){(a=e.instance).exports.__wasm_call_ctors()});function c(a){for(var e=new Uint8Array(a.length),b=0;b<a.length;++b){var i=a.charCodeAt(b);e[b]=i>96?i-97:i>64?i-39:i+4}for(var c=0,b=0;b<a.length;++b)e[c++]=e[b]<60?t[e[b]]:(e[b]-60)*64+e[++b];return e.buffer.slice(0,c)}function r(e,t,b,i,c,r){var o=a.exports.sbrk,l=b+3&-4,n=o(l*i),s=o(c.length),d=new Uint8Array(a.exports.memory.buffer);d.set(c,s);var p=e(n,b,i,s,c.length);if(0==p&&r&&r(n,l,i),t.set(d.subarray(n,n+b*i)),o(n-o(0)),0!=p)throw Error("Malformed buffer data: "+p)}var o={NONE:"",OCTAHEDRAL:"meshopt_decodeFilterOct",QUATERNION:"meshopt_decodeFilterQuat",EXPONENTIAL:"meshopt_decodeFilterExp"},l={ATTRIBUTES:"meshopt_decodeVertexBuffer",TRIANGLES:"meshopt_decodeIndexBuffer",INDICES:"meshopt_decodeIndexSequence"},n=[],s=0;function d(e){i.then(function(){var t=e.data;try{var b=new Uint8Array(t.count*t.size);r(a.exports[t.mode],b,t.count,t.size,t.source,a.exports[t.filter]),self.postMessage({id:t.id,count:t.count,action:"resolve",value:b},[b.buffer])}catch(a){self.postMessage({id:t.id,count:t.count,action:"reject",value:a})}})}return{ready:i,supported:!0,useWorkers:function(a){!function(a){for(var e=new Blob(["var instance; var ready = WebAssembly.instantiate(new Uint8Array(["+new Uint8Array(c(b))+"]), {}).then(function(result) { instance = result.instance; instance.exports.__wasm_call_ctors(); });self.onmessage = workerProcess;"+r.toString()+d.toString()],{type:"text/javascript"}),t=URL.createObjectURL(e),i=0;i<a;++i)n[i]=function(a){var e={object:new Worker(a),pending:0,requests:{}};return e.object.onmessage=function(a){var t=a.data;e.pending-=t.count,e.requests[t.id][t.action](t.value),delete e.requests[t.id]},e}(t);URL.revokeObjectURL(t)}(a)},decodeVertexBuffer:function(e,t,b,i,c){r(a.exports.meshopt_decodeVertexBuffer,e,t,b,i,a.exports[o[c]])},decodeIndexBuffer:function(e,t,b,i){r(a.exports.meshopt_decodeIndexBuffer,e,t,b,i)},decodeIndexSequence:function(e,t,b,i){r(a.exports.meshopt_decodeIndexSequence,e,t,b,i)},decodeGltfBuffer:function(e,t,b,i,c,n){r(a.exports[l[c]],e,t,b,i,a.exports[o[n]])},decodeGltfBufferAsync:function(e,t,b,c,d){return n.length>0?function(a,e,t,b,i){for(var c=n[0],r=1;r<n.length;++r)n[r].pending<c.pending&&(c=n[r]);return new Promise(function(r,o){var l=new Uint8Array(t),n=s++;c.pending+=a,c.requests[n]={resolve:r,reject:o},c.object.postMessage({id:n,count:a,size:e,source:l,mode:b,filter:i},[l.buffer])})}(e,t,b,l[c],o[d]):i.then(function(){var i=new Uint8Array(e*t);return r(a.exports[l[c]],i,e,t,b,a.exports[o[d]]),i})}}}(),p=s("jw0R5"),x=s("fMyA4");class v{constructor(a,e,t,b,i,c,r,o,l){this.p1=a,this.p2=e,this.p3=t,this.n1=b,this.n2=i,this.n3=c,this.uv1=r,this.uv2=o,this.uv3=l,this.aa=new p.Vector3(1/0,1/0,1/0),this.bb=new p.Vector3(-1/0,-1/0,-1/0),this.center=new p.Vector3(0,0,0),this.computeBoundingBox(),this.computeCenteic()}computeBoundingBox(){this.aa.x=Math.min(this.p1.x,Math.min(this.p2.x,this.p3.x)),this.aa.y=Math.min(this.p1.y,Math.min(this.p2.y,this.p3.y)),this.aa.z=Math.min(this.p1.z,Math.min(this.p2.z,this.p3.z)),this.bb.x=Math.max(this.p1.x,Math.max(this.p2.x,this.p3.x)),this.bb.y=Math.max(this.p1.y,Math.max(this.p2.y,this.p3.y)),this.bb.z=Math.max(this.p1.z,Math.max(this.p2.z,this.p3.z))}computeCenteic(){this.center=new p.Vector3((this.p1.x+this.p2.x+this.p3.x)/3,(this.p1.y+this.p2.y+this.p3.y)/3,(this.p1.z+this.p2.z+this.p3.z)/3)}}class k{constructor(){this.aa=new p.Vector3(1/0,1/0,1/0),this.bb=new p.Vector3(-1/0,-1/0,-1/0),this.id=null,this.isLeaf=null,this.left=null,this.right=null,this.index=null,this.size=null}}class y{constructor(a,e=8){this.position=a.attributes.position.array,a.attributes.normal||a.computeVertexNormals(),this.normal=a.attributes.normal.array,a.attributes.uv?this.uv=a.attributes.uv.array:this.uv=[],this.totalTriangles=this.position.length/9,this.triangles=[],this.nodes=[],this.leafSize=e,this.prepare()}prepare(){this.nodes=[],this.triangles=[];for(let a=0;a<this.totalTriangles;++a)this.triangles.push(new v(new p.Vector3(this.position[9*a],this.position[9*a+1],this.position[9*a+2]),new p.Vector3(this.position[9*a+3],this.position[9*a+4],this.position[9*a+5]),new p.Vector3(this.position[9*a+6],this.position[9*a+7],this.position[9*a+8]),new p.Vector3(this.normal[9*a],this.normal[9*a+1],this.normal[9*a+2]),new p.Vector3(this.normal[9*a+3],this.normal[9*a+4],this.normal[9*a+5]),new p.Vector3(this.normal[9*a+6],this.normal[9*a+7],this.normal[9*a+8]),new p.Vector2(this.uv[6*a],this.uv[6*a+1]),new p.Vector2(this.uv[6*a+2],this.uv[6*a+3]),new p.Vector2(this.uv[6*a+4],this.uv[6*a+5])))}setGeometry(a){this.position=a.attributes.position.array,a.attributes.normal||a.computeVertexNormals(),this.normal=a.attributes.normal.array,a.attributes.uv?(this.uv=a.attributes.uv.array,this.hasUv=!0):(this.uv=[],this.hasUv=!1),this.init()}rangeSort(a,e,t,b){let i=a.slice(0,e),c=a.slice(e,t),r=a.slice(t,this.totalTriangles);return c.sort(b),i.concat(c).concat(r)}sortTrianglesByLongestAxis(a,e,t){let b=a.bb.x-a.aa.x,i=a.bb.y-a.aa.y,c=a.bb.z-a.aa.z;b>=i&&b>=c&&(this.triangles=this.rangeSort(this.triangles,e,t+1,(a,e)=>a.center.x-e.center.x)),i>=b&&i>=c&&(this.triangles=this.rangeSort(this.triangles,e,t+1,(a,e)=>a.center.y-e.center.y)),c>=i&&c>=b&&(this.triangles=this.rangeSort(this.triangles,e,t+1,(a,e)=>a.center.z-e.center.z))}createNode(a,e){let t=new k,b=this.triangles;for(let i=a;i<=e;++i){let a=Math.min(b[i].p1.x,Math.min(b[i].p2.x,b[i].p3.x)),e=Math.min(b[i].p1.y,Math.min(b[i].p2.y,b[i].p3.y)),c=Math.min(b[i].p1.z,Math.min(b[i].p2.z,b[i].p3.z));t.aa.x=Math.min(t.aa.x,a),t.aa.y=Math.min(t.aa.y,e),t.aa.z=Math.min(t.aa.z,c);let r=Math.max(b[i].p1.x,Math.max(b[i].p2.x,b[i].p3.x)),o=Math.max(b[i].p1.y,Math.max(b[i].p2.y,b[i].p3.y)),l=Math.max(b[i].p1.z,Math.max(b[i].p2.z,b[i].p3.z));t.bb.x=Math.max(t.bb.x,r),t.bb.y=Math.max(t.bb.y,o),t.bb.z=Math.max(t.bb.z,l)}return this.nodes.push(t),t.id=this.nodes.length-1,t.isLeaf=!1,t.left=t.right=t.index=0,t}createSahNode(a,e){let t=this.createNode(a,e);return{Split:this.calculateSah(a,e),Node:t}}calculateSah(a,e){let t=1/0,b=0,i=0;for(let c=0;c<3;++c){this.sortTrianglesByAxis(c,a,e);let r=[],o=[],l=[],n=[];for(let t=0;t<e-a+1;++t)r.push(new p.Vector3(1/0,1/0,1/0)),l.push(new p.Vector3(1/0,1/0,1/0)),o.push(new p.Vector3(-1/0,-1/0,-1/0)),n.push(new p.Vector3(-1/0,-1/0,-1/0));for(let t=a;t<=e;++t){let b=this.triangles[t],i=+(t!=a);o[t-a].x=Math.max(o[t-a-i].x,Math.max(b.p1.x,Math.max(b.p2.x,b.p3.x))),o[t-a].y=Math.max(o[t-a-i].y,Math.max(b.p1.y,Math.max(b.p2.y,b.p3.y))),o[t-a].z=Math.max(o[t-a-i].z,Math.max(b.p1.z,Math.max(b.p2.z,b.p3.z))),r[t-a].x=Math.min(r[t-a-i].x,Math.min(b.p1.x,Math.min(b.p2.x,b.p3.x))),r[t-a].y=Math.min(r[t-a-i].y,Math.min(b.p1.y,Math.min(b.p2.y,b.p3.y))),r[t-a].z=Math.min(r[t-a-i].z,Math.min(b.p1.z,Math.min(b.p2.z,b.p3.z))),b=this.triangles[a+e-t],n[e-t].x=Math.max(n[e-t+i].x,Math.max(b.p1.x,Math.max(b.p2.x,b.p3.x))),n[e-t].y=Math.max(n[e-t+i].y,Math.max(b.p1.y,Math.max(b.p2.y,b.p3.y))),n[e-t].z=Math.max(n[e-t+i].z,Math.max(b.p1.z,Math.max(b.p2.z,b.p3.z))),l[e-t].x=Math.min(l[e-t+i].x,Math.min(b.p1.x,Math.min(b.p2.x,b.p3.x))),l[e-t].y=Math.min(l[e-t+i].y,Math.min(b.p1.y,Math.min(b.p2.y,b.p3.y))),l[e-t].z=Math.min(l[e-t+i].z,Math.min(b.p1.z,Math.min(b.p2.z,b.p3.z)))}let s=1/0,d=a;for(let t=a;t<=e-1;++t){let b=r[t-a],i=o[t-a],c=i.x-b.x,p=i.y-b.y,h=i.z-b.z,f=c*p+c*h+p*h,g=l[t-a],m=n[t-a];c=m.x-g.x;let u=f*(t-a+1)+(c*(p=m.y-g.y)+c*(h=m.z-g.z)+p*h)*(e-t);u<s&&(s=u,d=t)}s<t&&(t=s,i=c,b=d)}return this.sortTrianglesByAxis(i,a,e),b}buildRecursiveMedian(a,e){if(a>e)return;let t=this.createNode(a,e);if(e-a+1<=this.leafSize)return t.isLeaf=!0,t.index=a,t.size=e-a+1,t.id;this.sortTrianglesByLongestAxis(t,a,e);let b=Math.floor((a+e)/2),i=this.buildRecursiveMedian(a,b),c=this.buildRecursiveMedian(b+1,e);return t.left=i,t.right=c,t.id}buildRecursiveSAH(a,e){if(a>e)return;let t=this.createNode(a,e);if(t.isLeaf=!1,e-a+1<=this.leafSize)return t.isLeaf=!0,t.index=a,t.size=e-a+1,t.id;let b=this.calculateSah(a,e);return t.left=this.buildRecursiveSAH(a,b),t.right=this.buildRecursiveSAH(b+1,e),t.id}buildIterativeMedian(){let a=[];function e(e,t,b,i){a.push([e,t,b,i])}for(e(0,this.totalTriangles-1,null,null);a.length>0;){let t=a.pop(),b=t[0],i=t[1],c=t[2],r=t[3];if(b>i)return;let o=this.createNode(b,i);if(c&&("left"==r?c.left=o.id:"right"==r&&(c.right=o.id)),i-b<this.leafSize){o.isLeaf=!0,o.index=b,o.size=i-b+1;continue}this.sortTrianglesByLongestAxis(o,b,i);let l=Math.floor((b+i)/2);!(l<b)&&!(l>i)&&(e(b,l,o,"left"),e(l+1,i,o,"right"))}}buildIterativeSAH(){let a=[];function e(e,t,b,i){a.push({ok:!1,left:e,right:t,split:b,node:i})}let{Split:t,Node:b}=this.createSahNode(0,this.totalTriangles-1);for(e(0,this.totalTriangles-1,t,b);a.length>0;)a.forEach((t,b)=>{if(t.ok){a.splice(b,1);return}let{left:i,right:c,node:r}=t;if(i>c){t.ok=!0,a.splice(b,1);return}if(r.isLeaf=!1,c-i+1<=this.leafSize){r.index=i,r.size=c-i+1,r.isLeaf=!0,t.ok=!0,a.splice(b,1);return}let o=t.split,l=this.createSahNode(i,o);r.left=l.Node.id,e(i,o,l.Split,l.Node),r.right=(l=this.createSahNode(o+1,c)).Node.id,e(o+1,c,l.Split,l.Node),t.node=r,t.ok=!0,a.splice(b,1)})}build(a=1,e=0){switch(a<<1||e){case 0:case 1:this.buildRecursiveMedian(0,this.totalTriangles-1);break;case 2:this.buildIterativeMedian();break;case 3:this.buildIterativeSAH()}}}class w{constructor(a){this.model=a,this.geometries=[]}generate(){this.model.traverse(a=>{a.isMesh&&(a.geometry.applyMatrix4(a.matrix),this.geometries.push(a.geometry))});let a=new y((0,x.mergeGeometries)(this.geometries).toNonIndexed()),e=performance.now();a.build();let t=performance.now();console.log(`BVH construct time: ${(t-e).toFixed(2)} ms.`);let{totalTriangles:b,triangles:i,nodes:c}=a,r=8*b,o=~~Math.pow(2,Math.log2(r/512))+1,l=o,n=new Float32Array(512*o*4),s=32;for(let a=0;a<b;++a){let e=i[a],t=e.p1,b=e.p2,c=e.p3,r=e.n1,o=e.n2,l=e.n3,d=e.uv1,p=e.uv2,h=e.uv3;n[s*a+0]=t.x,n[s*a+1]=t.y,n[s*a+2]=t.z,n[s*a+3]=b.x,n[s*a+4]=b.y,n[s*a+5]=b.z,n[s*a+6]=c.x,n[s*a+7]=c.y,n[s*a+8]=c.z,n[s*a+9]=r.x,n[s*a+10]=r.y,n[s*a+11]=r.z,n[s*a+12]=o.x,n[s*a+13]=o.y,n[s*a+14]=o.z,n[s*a+15]=l.x,n[s*a+16]=l.y,n[s*a+17]=l.z,n[s*a+18]=d.x,n[s*a+19]=d.y,n[s*a+20]=p.x,n[s*a+21]=p.y,n[s*a+22]=h.x,n[s*a+23]=h.y,n[s*a+24]=0,n[s*a+25]=0,n[s*a+26]=0,n[s*a+27]=0,n[s*a+28]=0,n[s*a+29]=0,n[s*a+30]=0,n[s*a+31]=0}let d=new p.DataTexture(n,512,o,p.RGBAFormat,p.FloatType,p.Texture.DEFAULT_MAPPING,p.ClampToEdgeWrapping,p.ClampToEdgeWrapping,p.NearestFilter,p.NearestFilter,1,p.LinearEncoding);d.flipY=!1,d.generateMipmaps=!1,d.needsUpdate=!0,d.unpackAlignment=8;let h=c.length,f=o=~~Math.pow(2,Math.log2((r=4*h)/512))+1;s=16;let g=new Float32Array(512*o*4);for(let a=0;a<h;++a){let e=c[a];g[a*s]=e.aa.x,g[a*s+1]=e.aa.y,g[a*s+2]=e.aa.z,g[a*s+3]=e.bb.x,g[a*s+4]=e.bb.y,g[a*s+5]=e.bb.z,g[a*s+6]=e.id,g[a*s+7]=+!!c[a].isLeaf,g[a*s+8]=e.left,g[a*s+9]=e.right,g[a*s+10]=e.index,g[a*s+11]=e.size,g[a*s+12]=0,g[a*s+13]=0,g[a*s+14]=0,g[a*s+15]=0}let m=new p.DataTexture(g,512,o,p.RGBAFormat,p.FloatType,p.Texture.DEFAULT_MAPPING,p.ClampToEdgeWrapping,p.ClampToEdgeWrapping,p.NearestFilter,p.NearestFilter,1,p.LinearEncoding);return m.flipY=!1,m.generateMipmaps=!1,m.needsUpdate=!0,m.unpackAlignment=4,{triangle:{dataTexture:d,textureWidth:512,textureHeight:l},bvh:{dataTexture:m,textureWidth:512,textureHeight:f}}}}var p=(s("jw0R5"),s("jw0R5"));class j extends p.ShaderMaterial{set needsUpdate(a){super.needsUpdate=!0,this.dispatchEvent({type:"recompilation"})}constructor(a){for(let e in super(a),this.uniforms)Object.defineProperty(this,e,{get(){return this.uniforms[e].value},set(a){this.uniforms[e].value=a}})}}class F extends j{constructor(){super({transparent:!1,depthWrite:!1,depthTest:!1,uniforms:{renderTexture:{type:"t",value:null},resolution:{type:"v2",value:null}},vertexShader:`
                void main() {
                    gl_Position = vec4(position, 1.0);
                }
            `,fragmentShader:`
                uniform sampler2D renderTexture;

                void main() {
                    pc_fragColor = texelFetch(renderTexture, ivec2(gl_FragCoord.xy), 0);
                }
                
            `})}}class z extends j{constructor(a,e,t){super({transparent:!1,depthWrite:!1,depthTest:!1,uniforms:{renderTexture:{type:"t",value:null},resolution:{type:"v2",value:null}},vertexShader:`
                void main() {
                    gl_Position = vec4(position, 1.0);
                }
            `,fragmentShader:`
                uniform sampler2D renderTexture;

                vec3 toneMapping(in vec3 c, float limit) {
                    float luminance = 0.3 * c.x + 0.6 * c.y + 0.1 * c.z;
                    return c * 1.0 / (1.0 + luminance / limit);
                }

                void main() {
                    vec3 outColor = texelFetch(renderTexture, ivec2(gl_FragCoord.xy), 0).rgb;
                    outColor = toneMapping(outColor, 1.5);
                    outColor = pow(outColor, vec3(1.0 / 2.2));
                    pc_fragColor = vec4(outColor, 1.0);
                }
                
            `})}}let T=`
    struct Triangle {
        vec3 p1, p2, p3;
        vec3 n1, n2, n3;
    };

    struct Material {
        vec3 emissive;
        vec3 baseColor;
        float subsurface;
        float metallic;
        float specular;
        float specularTint;
        float roughness;
        float anisotropic;
        float sheen;
        float sheenTint;
        float clearcoat;
        float clearcoatGloss;
        float IOR;
        float transmission;
    };
    
    struct Ray {
        vec3 origin;
        vec3 direction;
    };

    struct RayHit {
        bool isHit;
        bool isInside;
        float distance;
        vec3 position;
        vec3 normal;
        vec3 rayDirec;
        Material material;
    };

    struct BVHNode {
        vec3 aa;
        vec3 bb;
        int isLeaf;
        int left;
        int right;
        int index;
        int size;
    };
`,G=`

    Material Gold() {
        Material material;
        material.emissive = vec3(0.0);
        material.baseColor = vec3(1.0, 0.766, 0.336);
        material.subsurface = 0.0;
        material.metallic = 1.0;
        material.specular = 0.1;
        material.specularTint = 1.0;
        material.roughness = 0.35;
        material.anisotropic = 0.0;
        material.sheen = 0.0;
        material.sheenTint = 0.0;
        material.clearcoat = 0.0;
        material.clearcoatGloss = 0.0;
        material.IOR = 0.0;
        material.transmission = 0.0;
        return material;
    }

    Material Mirror() {
        Material material;
        material.emissive = vec3(0.0);
        material.baseColor = vec3(0.0);
        material.subsurface = 0.0;
        material.metallic = 0.0;
        material.specular = 1.0;
        material.specularTint = 1.0;
        material.roughness = 0.1;
        material.anisotropic = 0.0;
        material.sheen = 0.0;
        material.sheenTint = 0.0;
        material.clearcoat = 0.0;
        material.clearcoatGloss = 0.0;
        material.IOR = 0.0;
        material.transmission = 0.0;
        return material;
    }
`,R=`
    float sqr(float x) {
        return x * x;
    }

    void getTangent(vec3 N, inout vec3 tangent, inout vec3 bitangent) {
        vec3 helper = vec3(1, 0, 0);
        if(abs(N.x) > 0.999)
          helper = vec3(0, 0, 1);
        bitangent = normalize(cross(N, helper));
        tangent = normalize(cross(N, bitangent));
    }
`,H=`
    BVHNode getBVHNode(float i) {
        float width = bvhNodeDataTextureSize.x;
        // 3 slots
        ivec2 uv0 = ivec2(mod(texelsPerBVHNode * i + 0.0, width), texelsPerBVHNode * i / width);
        ivec2 uv1 = ivec2(mod(texelsPerBVHNode * i + 1.0, width), texelsPerBVHNode * i / width);
        ivec2 uv2 = ivec2(mod(texelsPerBVHNode * i + 2.0, width), texelsPerBVHNode * i / width);

        vec4 texel0 = texelFetch(bvhNodeDataTexture, uv0, 0);
        vec4 texel1 = texelFetch(bvhNodeDataTexture, uv1, 0);
        vec4 texel2 = texelFetch(bvhNodeDataTexture, uv2, 0);

        vec3 aa = texel0.xyz;
        vec3 bb = vec3(texel0.w, texel1.xy);
        // int id = int(texel1.z);
        int isLeaf = int(texel1.w);

        int left = int(texel2.x);
        int right = int(texel2.y);
        int index = int(texel2.z);
        int size = int(texel2.w);

        return BVHNode(aa, bb, isLeaf, left, right, index, size);
    }

    Triangle getTriangle(float i) {
        float width = triangleDataTextureSize.x;
      
        ivec2 uv0 = ivec2(mod(texelsPerTriangle * i + 0.0, width), texelsPerTriangle * i / width);
        ivec2 uv1 = ivec2(mod(texelsPerTriangle * i + 1.0, width), texelsPerTriangle * i / width);
        ivec2 uv2 = ivec2(mod(texelsPerTriangle * i + 2.0, width), texelsPerTriangle * i / width);
        ivec2 uv3 = ivec2(mod(texelsPerTriangle * i + 3.0, width), texelsPerTriangle * i / width);
        ivec2 uv4 = ivec2(mod(texelsPerTriangle * i + 4.0, width), texelsPerTriangle * i / width);
        ivec2 uv5 = ivec2(mod(texelsPerTriangle * i + 5.0, width), texelsPerTriangle * i / width);
      
        vec4 texel0 = texelFetch(triangleDataTexture, uv0, 0);
        vec4 texel1 = texelFetch(triangleDataTexture, uv1, 0);
        vec4 texel2 = texelFetch(triangleDataTexture, uv2, 0);
        vec4 texel3 = texelFetch(triangleDataTexture, uv3, 0);
        vec4 texel4 = texelFetch(triangleDataTexture, uv4, 0);
        vec4 texel5 = texelFetch(triangleDataTexture, uv5, 0);
      
        vec3 p1 = texel0.xyz;
        vec3 p2 = vec3(texel0.w, texel1.xy);
        vec3 p3 = vec3(texel1.zw, texel2.x);
        vec3 n1 = texel2.yzw;
        vec3 n2 = texel3.xyz;
        vec3 n3 = vec3(texel3.w, texel4.xy);
        // vec2 t1 = texel4.zw;
        // vec2 t2 = texel5.xy;
        // vec2 t3 = texel5.zw;
        return Triangle(p1, p2, p3, n1, n2, n3);
    }
`,A=`
    uint updateSeed(float width, float height, float samples) {
        return uint(uint((pos.x * 0.5 + 0.5) * (width)) * uint(1973) +
        uint((pos.y * 0.5 + 0.5) * (height)) * uint(9277) +
        uint(samples) * uint(26699)) | uint(1);
    }
    
    void wang_hash(inout uint seed) {
        seed = uint(seed ^ uint(61)) ^ uint(seed >> uint(16));
        seed *= uint(9);
        seed = seed ^ (seed >> 4);
        seed *= uint(0x27d4eb2d);
        seed = seed ^ (seed >> 15);
    }
    
    float rand() {
        wang_hash(seed);
        return float(seed) / 4294967296.0;
    }
  
`,P=`
    Ray createCameraRay() {
        vec2 pixelOffset = vec2((rand() - 0.5), (rand() - 0.5));
        vec2 uv = ((gl_FragCoord.xy + pixelOffset) / resolution) * 2.0 - 1.0;
        vec3 direction = (matrixWorld * projectionMatrixInverse * vec4(uv, 1.0, 1.0)).xyz;
        direction = normalize(direction);
        return Ray(cameraPosition, direction);
    }
    
    RayHit createHit() {
        RayHit hit;
        hit.isHit = false;
        hit.isInside = false;
        hit.distance = INFINITY;
        hit.position = vec3(INFINITY);
        hit.normal = vec3(0.0);
        hit.rayDirec = vec3(0.0);
        hit.material = Gold();
        return hit;
    }

`,S=`
    bool hitTriangle_MT97(Ray ray, vec3 vert0, vec3 vert1, vec3 vert2, inout float t, inout float u, inout float v) {
        // find vectors for two edges sharing vert0
        vec3 edge1 = vert1 - vert0;
        vec3 edge2 = vert2 - vert0;
        // begin calculating determinant - also used to calculate U parameter
        vec3 pvec = cross(ray.direction, edge2);
        // if determinant is near zero, ray lies in plane of triangle
        float det = dot(edge1, pvec);
        // use backface culling
        // if (det < EPSILON)
        // 	return false;
        float inv_det = 1.0 / det;
        // calculate distance from vert0 to ray origin
        vec3 tvec = ray.origin - vert0;
        // calculate U parameter and test bounds
        u = dot(tvec, pvec) * inv_det;
        if(u < 0.0 || u > 1.0)
        return false;
        // prepare to test V parameter
        vec3 qvec = cross(tvec, edge1);
        // calculate V parameter and test bounds
        v = dot(ray.direction, qvec) * inv_det;
        if(v < 0.0 || u + v > 1.0)
        return false;
        // calculate t, ray intersects triangle
        t = dot(edge2, qvec) * inv_det;
        return true;
    }

    void hitTriangle(Triangle tri, in Ray ray, inout RayHit hit) {
        float t, u, v;
        if(hitTriangle_MT97(ray, tri.p1, tri.p2, tri.p3, t, u, v)) {
        if(t > 0.0 && t < hit.distance) {
            hit.isHit = true;
            hit.distance = t;
            hit.position = ray.origin + t * ray.direction;
            // caculate the normal for each indivial triangle
            // hit.normal = normalize(cross(tri.p2 - tri.p1, tri.p3 - tri.p2));
            // use the origin normal of vertex to get a somooth transition
            hit.normal = ((tri.n1 + tri.n2 + tri.n3) / 3.0);
            hit.rayDirec = ray.direction;
            if(dot(hit.normal, hit.rayDirec) > 0.0) {
            hit.isInside = true;
            }
        }
        }
    }
    
    void hitTriangles(int begin, int end, inout Ray ray, inout RayHit hit) {
        for(int i = begin; i <= end; ++i) {
        Triangle tri = getTriangle(float(i));
        hitTriangle(tri, ray, hit);
        }
    }
  
    float hitAABB(Ray ray, vec3 aa, vec3 bb) {
        vec3 origin = ray.origin;
        vec3 direction = ray.direction;
        float ox = origin.x;
        float oy = origin.y;
        float oz = origin.z;
        float dx = direction.x;
        float dy = direction.y;
        float dz = direction.z;
        float tx_min, ty_min, tz_min;
        float tx_max, ty_max, tz_max;
        float x0 = aa.x;
        float y0 = aa.y;
        float z0 = aa.z;
        float x1 = bb.x;
        float y1 = bb.y;
        float z1 = bb.z;
        // when ray in left or right plane and ray origin not inside box
        if(abs(dx) < EPSILON) {
            if(ox > x1 || ox < x0)
                return -1.0;
            } else {
            if(dx >= 0.0) {
                tx_min = (x0 - ox) / dx;
                tx_max = (x1 - ox) / dx;
            } else {
                tx_min = (x1 - ox) / dx;
                tx_max = (x0 - ox) / dx;
            }
        }
    
        if(abs(dy) < EPSILON) {
            if(oy > y1 || oy < y0)
                return -1.0;
            } else {
            if(dy >= 0.0) {
                ty_min = (y0 - oy) / dy;
                ty_max = (y1 - oy) / dy;
            } else {
                ty_min = (y1 - oy) / dy;
                ty_max = (y0 - oy) / dy;
            }
        
            }
        
            if(abs(dz) < EPSILON) {
            if(oz > z1 || oz < z0)
                return -1.0;
            } else {
            if(dz >= 0.0) {
                tz_min = (z0 - oz) / dz;
                tz_max = (z1 - oz) / dz;
            } else {
                tz_min = (z1 - oz) / dz;
                tz_max = (z0 - oz) / dz;
            }
    
        }
    
        float t0 = max(tz_min, max(tx_min, ty_min));
        float t1 = min(tz_max, min(tx_max, ty_max));
    
        return (t1 >= t0) ? ((t0 > 0.0) ? (t0) : (t1)) : (-1.0);
    }

    void hitBVH(Ray ray, inout RayHit hit) {
        int stack[64];
        int sp = 0;
        stack[sp++] = 0;
        while(sp > 0 && sp < 64) {
            
            int index = stack[--sp];
            BVHNode node = getBVHNode(float(index));
            float d = hitAABB(ray, node.aa, node.bb);
        
            if(d > 0.0) {
                if(node.isLeaf == 1) {
                    int start = node.index;
                    int end = node.index + node.size - 1;
                    hitTriangles(start, end, ray, hit);
                    continue;
                }
        
                int left = node.left;
                int right = node.right;
                float dLeft = INFINITY;
                float dRight = INFINITY;
                if(left > 0) {
                    BVHNode leftNode = getBVHNode(float(left));
                    dLeft = hitAABB(ray, leftNode.aa, leftNode.bb);
                }
        
                if(right > 0) {
                    BVHNode rightNode = getBVHNode(float(right));
                    dRight = hitAABB(ray, rightNode.aa, rightNode.bb);
                }
        
                if(dLeft < INFINITY && dRight < INFINITY) {
                    if(dLeft > 0.0 && dRight > 0.0) {
                        if(dLeft < dRight) {
                            stack[sp++] = right;
                            stack[sp++] = left;
                        } else {
                            stack[sp++] = left;
                            stack[sp++] = right;
                        }
                    } else if(dLeft > 0.0) {
                        stack[sp++] = left;
                    } else if(dRight > 0.0) {
                        stack[sp++] = right;
                    }
                }
            }
        }
    }

    RayHit hitScene(Ray ray) {
        RayHit bvhHit = createHit();
        hitBVH(ray, bvhHit);
        return bvhHit;
    }
`,O=`
    vec3 SampleHemisphere() {
        float z = rand();
        float r = max(0.0, sqrt(1.0 - z * z));
        float phi = 2.0 * PI * rand();
        return vec3(r * cos(phi), r * sin(phi), z);
    }
    
    vec3 toNormalHemisphere(vec3 v, vec3 N) {
        vec3 helper = vec3(1, 0, 0);
        if (abs(N.x) > 0.999)
            helper = vec3(0, 0, 1);
        vec3 tangent = normalize(cross(N, helper));
        vec3 bitangent = normalize(cross(N, tangent));
        return v.x * tangent + v.y * bitangent + v.z * N;
    }
    
    vec3 sampleHdr(Ray ray) {
        float theta = asin(ray.direction.y) * ONE_OVER_PI + 0.5;
        float phi = atan(ray.direction.z, ray.direction.x) * ONE_OVER_TWO_PI + 0.5;
        vec3 color = texture(hdrTexture, vec2(phi, theta)).rgb;
        // clamp to prevent hdr firefly
        return min(color, vec3(10.0));
    }

`,M=`

    float SchlickFresnel(float u) {
        float m = clamp(1.0 - u, 0.0, 1.0);
        float m2 = m * m;
        return m2 * m2 * m; // pow(m,5)
    }
    
    float GTR1(float NdotH, float a) {
        if(a >= 1.0)
        return 1.0 / PI;
        float a2 = a * a;
        float t = 1.0 + (a2 - 1.0) * NdotH * NdotH;
        return (a2 - 1.0) / (PI * log(a2) * t);
    }
    
    float GTR2(float NdotH, float a) {
        float a2 = a * a;
        float t = 1.0 + (a2 - 1.0) * NdotH * NdotH;
        return a2 / (PI * t * t);
    }
    
    float GTR2_aniso(float NdotH, float HdotX, float HdotY, float ax, float ay) {
        return 1.0 / (PI * ax * ay * sqr(sqr(HdotX / ax) + sqr(HdotY / ay) + NdotH * NdotH));
    }

    float smithG_GGX(float NdotV, float alphaG) {
        float a = alphaG * alphaG;
        float b = NdotV * NdotV;
        return 1.0 / (NdotV + sqrt(a + b - a * b));
    }
    
    float smithG_GGX_aniso(float NdotV, float VdotX, float VdotY, float ax, float ay) {
        return 1.0 / (NdotV + sqrt(sqr(VdotX * ax) + sqr(VdotY * ay) + sqr(NdotV)));
    }

    vec3 BRDF_Evaluate(vec3 V, vec3 N, vec3 L, vec3 X, vec3 Y, in Material material) {

        float NdotL = dot(N, L);
        float NdotV = dot(N, V);
        if(NdotL < 0.0 || NdotV < 0.0)
        return vec3(0.0);
    
        vec3 H = normalize(L + V);
        float NdotH = dot(N, H);
        float LdotH = dot(L, H);
    
        // albedo
        vec3 Cdlin = material.baseColor;
        float Cdlum = 0.3 * Cdlin.r + 0.6 * Cdlin.g + 0.1 * Cdlin.b;
        vec3 Ctint = (Cdlum > 0.0) ? (Cdlin / Cdlum) : (vec3(1.0));
        vec3 Cspec = material.specular * mix(vec3(1.0), Ctint, material.specularTint);
        vec3 Cspec0 = mix(0.08 * Cspec, Cdlin, material.metallic); 
        vec3 Csheen = mix(vec3(1.0), Ctint, material.sheenTint);   
    
        // diffuse
        float Fd90 = 0.5 + 2.0 * LdotH * LdotH * material.roughness;
        float FL = SchlickFresnel(NdotL);
        float FV = SchlickFresnel(NdotV);
        float Fd = mix(1.0, Fd90, FL) * mix(1.0, Fd90, FV);
    
        // subsurface scattering
        float Fss90 = LdotH * LdotH * material.roughness;
        float Fss = mix(1.0, Fss90, FL) * mix(1.0, Fss90, FV);
        float ss = 1.25 * (Fss * (1.0 / (NdotL + NdotV) - 0.5) + 0.5);
    
        // specular -- uniso
        float alpha = material.roughness * material.roughness;
        float Ds = GTR2(NdotH, alpha);
        float FH = SchlickFresnel(LdotH);
        vec3 Fs = mix(Cspec0, vec3(1), FH);
        float Gs = smithG_GGX(NdotL, material.roughness);
        Gs *= smithG_GGX(NdotV, material.roughness);
    
        // specular -- aniso
        // float aspect = sqrt(1.0 - material.anisotropic * 0.9);
        // float ax = max(0.001, sqr(material.roughness) / aspect);
        // float ay = max(0.001, sqr(material.roughness) * aspect);
        // float Ds = GTR2_aniso(NdotH, dot(H, X), dot(H, Y), ax, ay);
        // float FH = SchlickFresnel(LdotH);
        // vec3 Fs = mix(Cspec0, vec3(1), FH);
        // float Gs;
        // Gs = smithG_GGX_aniso(NdotL, dot(L, X), dot(L, Y), ax, ay);
        // Gs *= smithG_GGX_aniso(NdotV, dot(V, X), dot(V, Y), ax, ay);
    
        float Dr = GTR1(NdotH, mix(0.1, 0.001, material.clearcoatGloss));
        float Fr = mix(0.04, 1.0, FH);
        float Gr = smithG_GGX(NdotL, 0.25) * smithG_GGX(NdotV, 0.25);
    
        // sheen
        vec3 Fsheen = FH * material.sheen * Csheen;
    
        vec3 diffuse = (1.0 / PI) * mix(Fd, ss, material.subsurface) * Cdlin + Fsheen;
        vec3 clearcoat = vec3(0.25 * Gr * Fr * Dr * material.clearcoat);
        vec3 specular = Gs * Fs * Ds;

        return diffuse * (1.0 - material.metallic) + specular + clearcoat;
    
    }
`,q=`

    vec3 pathTrace() {
        Ray ray = createCameraRay();
    
        vec3 Le = vec3(0.0);
        vec3 Li = vec3(0.0);
        vec3 history = vec3(1.0);
    
        for(int bounce = 0; bounce < maxBounce; bounce++) {
            // Russia Roulette
            float survivalProb = min(1.0, max(history.r, max(history.g, history.b)));
            if(rand() > survivalProb) break;
            history /= survivalProb;

            RayHit hit = hitScene(ray);
            if(hit.isHit) {
        
                if(bounce == 0) {
                    Le = hit.material.emissive;
                }
        
                vec3 V = -hit.rayDirec;
                vec3 N = hit.normal;
                // random out direction
                vec3 L = toNormalHemisphere(SampleHemisphere(), hit.normal);
        
                // pdf of hemi sphere
                float pdf = ONE_OVER_TWO_PI;
        
                // float cosine_o = max(0.0, dot(V, N));
                float cosine_i = max(0.0, dot(L, N));
        
                vec3 tangent, bitangent;
                getTangent(N, tangent, bitangent);
        
                vec3 f_r = BRDF_Evaluate(V, N, L, tangent, bitangent, hit.material);
        
                // ray reflection
                ray.origin = hit.position + hit.normal * EPSILON;
                ray.direction = L;
                RayHit bounceHit = hitScene(ray);
        
                // miss
                if(!bounceHit.isHit) {
                    vec3 skyColor = sampleHdr(ray);
                    Li += history * skyColor * f_r * cosine_i / pdf;
                    break;
                }
        
                // accumulate energy
                vec3 emi = bounceHit.material.emissive;
                Li += history * emi * f_r * cosine_i / pdf;
        
                // next recursion
                hit = bounceHit;
                history *= f_r * cosine_i / pdf;
        
            } else {
                return sampleHdr(ray);
            }
        }
        return Le + Li;
    }
    
    void main(void) {
    
        seed = updateSeed(resolution.x, resolution.y, samples);
        
        vec3 pixelColor = pathTrace();
        vec3 previousColor = texelFetch(copyTexture, ivec2(gl_FragCoord.xy), 0).rgb;
        float alpha = 1.0 / (1.0 + samples);
        pc_fragColor = vec4(mix(previousColor, pixelColor, alpha), 1.0);
    }
`;class N extends j{constructor(){super({transparent:!1,depthWrite:!1,depthTest:!1,uniforms:{samples:{type:"f",value:null},maxBounce:{type:"i",value:null},resolution:{type:"v2",value:null},matrixWorld:{type:"m4",value:null},projectionMatrixInverse:{type:"m4",value:null},texelsPerTriangle:{type:"f",value:null},texelsPerBVHNode:{type:"f",value:null},triangleDataTexture:{type:"t",value:null},triangleDataTextureSize:{type:"v2",value:null},bvhNodeDataTexture:{type:"t",value:null},bvhNodeDataTextureSize:{type:"v2",value:null},copyTexture:{type:"t",value:null},hdrTexture:{type:"t",value:null}},vertexShader:`
                out vec3 pos;
                void main() {
                    gl_Position = vec4(position, 1.0);
                    pos = position;
                }
            `,fragmentShader:`
                #ifdef GL_FRAGMENT_PRECISION_HIGH
                    precision highp float;
                #else
                    precision mediump float;
                #endif

                #define PI 3.1415926535897
                #define TWO_PI 6.283185307179
                #define ONE_OVER_PI      0.31830988618
                #define ONE_OVER_TWO_PI  0.15915494309
                #define INFINITY 1000000.0
                #define EPSILON 0.00001

                in vec3 pos;
                uniform float samples;
                uniform int maxBounce;
                uniform vec2 resolution;
                uniform mat4 matrixWorld;
                uniform mat4 projectionMatrixInverse;
                uniform sampler2D hdrTexture;
                uniform sampler2D triangleDataTexture;
                uniform sampler2D bvhNodeDataTexture;
                uniform sampler2D copyTexture;

                uniform float texelsPerTriangle;
                uniform float texelsPerBVHNode;
                uniform vec2 triangleDataTextureSize;
                uniform vec2 bvhNodeDataTextureSize;

                uint seed;

                ${T}
                ${G}
                ${R}
                ${H}
                ${A}
                ${P}
                ${S}
                ${O}
                ${M}
                ${q}
            `})}}function*C(){let{renderer:a,scene:e,camera:t,quadCamera:b,pathTracingRenderTarget:i,copyRenderTarget:c,copyScene:r,outputScene:o}=this,l=this.pathTracingQuad.material;for(;;)this.samples++,t.updateMatrixWorld(),t.updateProjectionMatrix(),l.samples=this.samples,l.matrixWorld=t.matrixWorld,l.projectionMatrixInverse=t.projectionMatrixInverse,a.setRenderTarget(i),a.render(e,t),a.setRenderTarget(c),a.render(r,b),a.setRenderTarget(null),a.render(o,b),yield}class E{constructor(a,e,t){this.renderer=a,this.scene=e,this.camera=t,this.task=null,this.samples=0,this.init()}init(){this.copyRenderTarget=new p.WebGLRenderTarget(1,1,{format:p.RGBAFormat,type:p.FloatType,magFilter:p.NearestFilter,minFilter:p.NearestFilter}),this.pathTracingRenderTarget=new p.WebGLRenderTarget(1,1,{format:p.RGBAFormat,type:p.FloatType,magFilter:p.NearestFilter,minFilter:p.NearestFilter}),this.quadCamera=new p.OrthographicCamera(-1,1,1,-1,0,1),this.pathTracingQuad=new p.Mesh(new p.PlaneGeometry(2,2),new N),this.copyQuad=new p.Mesh(new p.PlaneGeometry(2,2),new F),this.outputQuad=new p.Mesh(new p.PlaneGeometry(2,2),new z),this.scene.add(this.pathTracingQuad),this.copyScene=new p.Scene().add(this.copyQuad),this.outputScene=new p.Scene().add(this.outputQuad),this.pathTracingMaterial=this.pathTracingQuad.material,this.copyMaterial=this.copyQuad.material,this.outputMaterial=this.outputQuad.material,this._setContants(),this._setRenderTexture()}_setContants(){this.pathTracingMaterial.texelsPerTriangle=8,this.pathTracingMaterial.texelsPerBVHNode=4}_setRenderTexture(){this.pathTracingMaterial.copyTexture=this.copyRenderTarget.texture,this.copyMaterial.renderTexture=this.pathTracingRenderTarget.texture,this.outputMaterial.renderTexture=this.copyRenderTarget.texture}setBounce(a){this.pathTracingMaterial.maxBounce=a}setHdrTexture(a){a.minFilter=p.LinearFilter,a.magFilter=p.LinearFilter,a.generateMipmaps=!1,this.pathTracingMaterial.hdrTexture=a}setDataTexture(a,e){let t=this.pathTracingQuad.material;t.triangleDataTexture=a.dataTexture,t.triangleDataTextureSize={x:a.textureWidth,y:a.textureHeight},t.bvhNodeDataTexture=e.dataTexture,t.bvhNodeDataTextureSize={x:e.textureWidth,y:e.textureHeight}}setSize(a,e){a=~~a,e=~~e,(this.pathTracingRenderTarget.width!=a||this.pathTracingRenderTarget.height!=e)&&(this.renderer.setSize(a,e),this.pathTracingRenderTarget.setSize(a,e),this.copyRenderTarget.setSize(a,e),this.pathTracingMaterial.resolution={x:a,y:e},this.copyMaterial.resolution={x:a,y:e},this.outputMaterial.resolution={x:a,y:e})}update(){this.task||(this.task=C.call(this)),this.task.next()}reset(){this.samples=1}}let D=(0,s("2Tb7o").getAssetURL)(),L=D+"models/dragon.glb",B=D+"hdrs/kiara_5_noon_2k.hdr",V=document.querySelector("#info"),Q=!1,W=!1;(async function r(){(a=new p.WebGLRenderer({antialias:!0})).setSize(window.innerWidth,window.innerHeight),a.setClearColor(3355443,1),a.setPixelRatio(1),a.autoClear=!1,document.body.appendChild(a.domElement);let r=window.innerWidth,o=window.innerHeight;e=new p.Scene,t=new p.PerspectiveCamera(60,r/o,.1,1e4),(b=new g.OrbitControls(t,a.domElement)).target=new p.Vector3(0,0,0),new p.Clock,i=new m.default,document.body.appendChild(i.dom);let[l,n]=await Promise.all([new f().loadAsync(B),new(0,h.GLTFLoader)().setMeshoptDecoder(u).loadAsync(L)]),s=n.scene;e.add(s);let d=new p.Box3;d.setFromObject(s);let x=d.getSize(new p.Vector3);L.includes("dragon")?(t.position.x=100*x.z,t.position.y=150*x.y,t.position.z=100*x.x):L.includes("bunny")&&(t.position.x=-2*x.x,t.position.y=2*x.y,t.position.z=2*x.z),t.updateProjectionMatrix(),b.update();let{triangle:v,bvh:k}=new w(s).generate();(c=new E(a,e,t)).setSize(r,o),c.setBounce(3),c.setHdrTexture(l),c.setDataTexture(v,k),window.addEventListener("resize",()=>{let{innerWidth:a,innerHeight:e}=window;c.camera.aspect=a/e,c.reset(),c.setSize(a,e),c.update()}),window.addEventListener("mousedown",()=>{W=!0}),window.addEventListener("mouseup",()=>{W&&(W=!1,Q=!1)}),window.addEventListener("mousemove",()=>{W&&(Q=!0)}),function(a,e){let t=null;a.addEventListener("wheel",function(){t&&clearTimeout(t),Q=!0,t=setTimeout(e,50)})}(window,function(){Q=!1}),function a(){requestAnimationFrame(a),i.update(),b.update(),Q&&c.reset(),c.update(),V.innerText=`Samples: ${c.samples}`}()})();
//# sourceMappingURL=pathTracing.8770fbd1.js.map
