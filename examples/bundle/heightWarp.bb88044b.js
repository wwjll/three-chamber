let e,r,t,o,n,i,a,l,s,u,d,f,c;import"./cameraEditor.1acb9652.js";import"./cameraEditor.737f6996.js";function p(e,r,t,o){Object.defineProperty(e,r,{get:t,set:o,enumerable:!0,configurable:!0})}var m=globalThis,v={},_={},g=m.parcelRequire1149;null==g&&((g=function(e){if(e in v)return v[e].exports;if(e in _){var r=_[e];delete _[e];var t={id:e,exports:{}};return v[e]=t,r.call(t.exports,t,t.exports),t.exports}var o=Error("Cannot find module '"+e+"'");throw o.code="MODULE_NOT_FOUND",o}).register=function(e,r){_[e]=r},m.parcelRequire1149=g);var E=g.register;E("82VHk",function(e,r){p(e.exports,"default",()=>o);var t=function(){var e=0,r=document.createElement("div");function o(e){return r.appendChild(e.dom),e}function n(t){for(var o=0;o<r.children.length;o++)r.children[o].style.display=o===t?"block":"none";e=t}r.style.cssText="position:fixed;top:0;left:0;cursor:pointer;opacity:0.9;z-index:10000",r.addEventListener("click",function(t){t.preventDefault(),n(++e%r.children.length)},!1);var i=(performance||Date).now(),a=i,l=0,s=o(new t.Panel("FPS","#0ff","#002")),u=o(new t.Panel("MS","#0f0","#020"));if(self.performance&&self.performance.memory)var d=o(new t.Panel("MB","#f08","#201"));return n(0),{REVISION:16,dom:r,addPanel:o,showPanel:n,begin:function(){i=(performance||Date).now()},end:function(){l++;var e=(performance||Date).now();if(u.update(e-i,200),e>=a+1e3&&(s.update(1e3*l/(e-a),100),a=e,l=0,d)){var r=performance.memory;d.update(r.usedJSHeapSize/1048576,r.jsHeapSizeLimit/1048576)}return e},update:function(){i=this.end()},domElement:r,setMode:n}};t.Panel=function(e,r,t){var o=1/0,n=0,i=Math.round,a=i(window.devicePixelRatio||1),l=80*a,s=48*a,u=3*a,d=2*a,f=3*a,c=15*a,p=74*a,m=30*a,v=document.createElement("canvas");v.width=l,v.height=s,v.style.cssText="width:80px;height:48px";var _=v.getContext("2d");return _.font="bold "+9*a+"px Helvetica,Arial,sans-serif",_.textBaseline="top",_.fillStyle=t,_.fillRect(0,0,l,s),_.fillStyle=r,_.fillText(e,u,d),_.fillRect(f,c,p,m),_.fillStyle=t,_.globalAlpha=.9,_.fillRect(f,c,p,m),{dom:v,update:function(s,g){o=Math.min(o,s),n=Math.max(n,s),_.fillStyle=t,_.globalAlpha=1,_.fillRect(0,0,l,c),_.fillStyle=r,_.fillText(i(s)+" "+e+" ("+i(o)+"-"+i(n)+")",u,d),_.drawImage(v,f+a,c,p-a,m,f,c,p-a,m),_.fillRect(f+p-a,c,a,m),_.fillStyle=t,_.globalAlpha=.9,_.fillRect(f+p-a,c,a,i((1-s/g)*m))}}};var o=t}),E("kaU80",function(e,r){p(e.exports,"DISSOLVE_FRAGMENT_COMMON",()=>g("2Dsnb").DISSOLVE_FRAGMENT_COMMON),p(e.exports,"DISSOLVE_FRAGMENT_TYPE0",()=>g("2Dsnb").DISSOLVE_FRAGMENT_TYPE0),p(e.exports,"DISSOLVE_FRAGMENT_TYPE1",()=>g("2Dsnb").DISSOLVE_FRAGMENT_TYPE1),p(e.exports,"DISSOLVE_VERTEX_COMMON",()=>g("2Dsnb").DISSOLVE_VERTEX_COMMON),p(e.exports,"DISSOLVE_VERTEX_UV",()=>g("2Dsnb").DISSOLVE_VERTEX_UV),p(e.exports,"HEIGHT_WARP_FRAGMENT",()=>g("6bRX7").HEIGHT_WARP_FRAGMENT),p(e.exports,"HEIGHT_WARP_VERTEX",()=>g("6bRX7").HEIGHT_WARP_VERTEX),g("2Dsnb"),g("6bRX7")}),E("2Dsnb",function(e,r){p(e.exports,"DISSOLVE_VERTEX_COMMON",()=>t),p(e.exports,"DISSOLVE_VERTEX_UV",()=>o),p(e.exports,"DISSOLVE_FRAGMENT_COMMON",()=>n),p(e.exports,"DISSOLVE_FRAGMENT_TYPE0",()=>i),p(e.exports,"DISSOLVE_FRAGMENT_TYPE1",()=>a);let t=`
varying vec2 xUv;
#include <common>
`,o=`
xUv = uv;
#include <uv_vertex>
`,n=`
#include <common>
uniform float dissolveProgress;
uniform float edgeWidth;
uniform vec3 edgeColor;
uniform sampler2D noiseTexture;
uniform sampler2D edgeColorTexture;
varying vec2 xUv;
`,i=`
#include <dithering_fragment>
float noiseValue = texture2D(noiseTexture, xUv).r;
vec4 finalColor = linearToOutputTexel(vec4(edgeColor, gl_FragColor.a));
if (noiseValue > dissolveProgress) {
    discard;
}
if (noiseValue + edgeWidth > dissolveProgress) {
    gl_FragColor = vec4(finalColor.rgb, 1.0);
}
`,a=`
#include <dithering_fragment>
float noiseValue = texture2D(noiseTexture, xUv).r;
vec4 finalColor = texture2D(edgeColorTexture, xUv);
float alpha = step(noiseValue - edgeWidth, dissolveProgress);
gl_FragColor.a = alpha;
float useOrigin = step(noiseValue, dissolveProgress);
gl_FragColor.rgb = mix(finalColor.rgb, gl_FragColor.rgb, useOrigin);
`}),E("6bRX7",function(e,r){p(e.exports,"HEIGHT_WARP_VERTEX",()=>t),p(e.exports,"HEIGHT_WARP_FRAGMENT",()=>o);let t=`
varying vec4 v_color;
varying vec2 v_uv;
uniform float u_factor;
uniform float u_radius;
uniform sampler2D u_bump;
void main() {
    v_color = texture2D(u_bump, uv);
    v_uv = uv;
    float height = v_color.r * u_factor;
    float scale = (u_radius + height) / u_radius;
    vec3 vposition = position * scale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vposition, 1.0);
}
`,o=`
uniform vec3 u_color;
varying vec2 v_uv;
uniform sampler2D u_map;
void main() {
    gl_FragColor = vec4(u_color, 1.0) * texture2D(u_map, v_uv);
}
`});var x=g("jw0R5"),R=g("2sw9m"),h=g("ctZJO"),T=g("82VHk"),S=g("6BOAB");g("kaU80");var w=g("6bRX7");let b=(0,S.getAssetURL)(),O=(0,S.getRenderLoopController)(),V={radius:100,segments:640,factor:5,map:b+"textures/8081_earthmap4k.jpg",bump:b+"textures/8081_earthbump4k.jpg"};function D(){s.update(),e.render(o,r)}u=window.innerWidth,d=window.innerHeight,(e=new x.WebGLRenderer({antialias:!0})).setSize(u,d),e.setClearColor(1118481,1),document.body.appendChild(e.domElement),(r=new x.PerspectiveCamera(80,u/d,.1,1e4)).position.set(0,200,0),r.up.set(0,1,0),(t=new R.OrbitControls(r,e.domElement)).target=new x.Vector3(0,0,0),t.update(),t.addEventListener("change",()=>{O.requestRender()}),n=new x.TextureLoader,new h.Pane({title:"HeightWarp"}).addBinding(V,"factor",{min:0,max:50,step:.1}).on("change",e=>{a.uniforms.u_factor.value=e.value,O.requestRender()}),s=new T.default,document.body.appendChild(s.dom),O.configure({fps:30,render:D}),O.setRenderOnIdle(!1),window.addEventListener("resize",t=>{let o=window.innerWidth,n=window.innerHeight;r.aspect=o/n,r.updateProjectionMatrix(),e.setSize(o,n),O.requestRender()}),o=new x.Scene,f=new x.AmbientLight(0xfefefe),(c=new x.DirectionalLight(0xffffff)).position.set(0,5,0),c.intensity=2,o.add(f),o.add(c),i=new x.SphereGeometry(V.radius,V.segments,V.segments),a=new x.ShaderMaterial({uniforms:{u_radius:{value:V.radius},u_factor:{type:"f",value:V.factor},u_map:{value:n.load(V.map)},u_bump:{value:n.load(V.bump)},u_color:{value:new x.Color("rgb(255, 255, 255)")}},transparent:!0,vertexShader:w.HEIGHT_WARP_VERTEX,fragmentShader:w.HEIGHT_WARP_FRAGMENT}),l=new x.Mesh(i,a),o.add(l),O.requestRender();
//# sourceMappingURL=heightWarp.bb88044b.js.map
