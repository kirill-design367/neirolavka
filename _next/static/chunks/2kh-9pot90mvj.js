(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,49122,e=>{"use strict";let t=(e,t,r)=>{let o=e.createShader(t);return o?(e.shaderSource(o,r),e.compileShader(o),e.getShaderParameter(o,e.COMPILE_STATUS))?o:(e.deleteShader(o),null):null};function r(e,t,r,o,a){let n=e.getAttribLocation(t,r);if(n<0)return null;let i=e.createBuffer();return e.bindBuffer(e.ARRAY_BUFFER,i),e.bufferData(e.ARRAY_BUFFER,o,e.STATIC_DRAW),e.enableVertexAttribArray(n),e.vertexAttribPointer(n,a,e.FLOAT,!1,0,0),i}function o(e,t,r,o){let a=1/Math.tan(e*Math.PI/360),n=1/(r-o);return new Float32Array([a/t,0,0,0,0,a,0,0,0,0,(o+r)*n,-1,0,0,2*o*r*n,0])}function a(e){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,-e,1])}var n=e.i(89970);let i=(e=0,t=0,r=0)=>({x:e,y:t,z:r}),l=["--c-brand","--c-accent","--c-line-strong"],u=(e,t)=>e+Math.random()*(t-e),d=`
  precision mediump float;
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    // Край считается на пиксель, а не берётся из картинки: ступеньки
    // не бывает ни при каком размере точки.
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vAlpha;
    if (a <= 0.012) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;e.s(["mount",0,function(e,s){let f=function(e){let t={alpha:!0,antialias:!1,depth:!1,stencil:!1,premultipliedAlpha:!0,powerPreference:"low-power"};try{return e.getContext("webgl2",t)??e.getContext("webgl",t)??null}catch{return null}}(e);if(!f)return null;let m=window.matchMedia("(max-width: 640px)").matches,p=m?10:15,c=Math.tan(Math.PI/180*22.5),x=o(45,1,1,4e3),h=a(1),y=1,v=1,g=1,M=1,b=[],w={xmin:0,xmax:0,ymin:0,ymax:0},P=[],A=[],C=e=>{let t=Math.random()*Math.PI*2;e.vx=5*Math.cos(t),e.vy=5*Math.sin(t),e.dir=t,e.speed=u(3.5,7),e.pa=u(14,22),e.pb=u(25,37),e.swayA=u(.22,.5),e.swayB=u(.1,.28),e.wx=u(-.16,.16),e.wy=u(.12,.3)*(.5>Math.random()?-1:1),e.rx=6.28*Math.random(),e.ry=6.28*Math.random(),e.popped=0,e.pop=0,e.gone=!1};for(let e=0;e<p;e++){let e={r:u(17,34)*(m?.82:1),x:0,y:0,z:0,vx:0,vy:0,dir:0,speed:0,pa:1,pb:1,swayA:0,swayB:0,rx:0,ry:0,wx:0,wy:0,popped:0,pop:0,gone:!1};C(e),P.push(e)}let S=P.map(e=>Math.round(6*e.r)),L=S.reduce((e,t)=>e+t,0),R=new Float32Array(3*L),E=new Float32Array(3*L),T=new Float32Array(L),z=new Float32Array(L),B=new Float32Array(L),_=new Float32Array(L),F=0;P.forEach((e,t)=>{let r=S[t];for(let e=0;e<r;e++){let o=1-(2*e+1)/r,a=Math.sqrt(Math.max(0,1-o*o)),n=2.399963229728653*e,i=1+u(-.035,.035),l=Math.cos(n)*a,d=Math.sin(n)*a;R[3*F]=l*i,R[3*F+1]=o*i,R[3*F+2]=d*i;let s=u(.8,1.9);E[3*F]=l*s,E[3*F+1]=o*s+u(.06,.4),E[3*F+2]=d*s,T[F]=u(1.2,2.6),z[F]=3*Math.random()|0,B[F]=Math.random()*Math.PI*2,_[F]=t,F++}});let U=function(e,r,o){let a=t(e,e.VERTEX_SHADER,r),n=t(e,e.FRAGMENT_SHADER,o);if(!a||!n)return null;let i=e.createProgram();return i?(e.attachShader(i,a),e.attachShader(i,n),e.linkProgram(i),e.deleteShader(a),e.deleteShader(n),e.getProgramParameter(i,e.LINK_STATUS))?i:(e.deleteProgram(i),null):null}(f,`
  #define N ${p}

  // Матрицы и позицию точки библиотека прежде объявляла сама.
  uniform mat4 projectionMatrix;
  uniform mat4 viewMatrix;
  attribute vec3 position;

  uniform float uSizeScale;   // множитель gl_PointSize: dpr * расстояние камеры
  uniform float uCamZ;        // расстояние камеры, оно же глубина плоскости z = 0
  uniform vec3  uPointer;     // курсор в координатах мира
  uniform float uPress;       // сила реакции на курсор, 0..1, едет с инерцией
  uniform float uTime;
  uniform float uInk;         // плотность краски: в тёмной теме токены уходят в фон
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform vec3  uColorC;
  /** xyz — центр пузыря, w — его радиус в пикселях. */
  uniform vec4  uPos[N];
  /** x, y — углы поворота оболочки; z — доля разлёта 0..1. */
  uniform vec4  uRot[N];

  attribute float aBubble;    // к какому пузырю принадлежит точка
  attribute float aSize;
  attribute float aTint;
  attribute float aPhase;
  attribute vec3  aVel;       // направление разлёта, в долях радиуса

  varying vec3  vColor;
  varying float vAlpha;

  vec3 spin(vec3 p, float ax, float ay) {
    float s = sin(ax), c = cos(ax);
    p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
    float s2 = sin(ay), c2 = cos(ay);
    return vec3(p.x * c2 + p.z * s2, p.y, -p.x * s2 + p.z * c2);
  }

  void main() {
    int i = int(aBubble + 0.5);
    vec4 P = uPos[i];
    vec4 R = uRot[i];
    float radius = P.w;
    float pop = R.z;

    // Оболочка чуть дышит — это плёнка, а не жёсткий каркас.
    vec3 unit = spin(position, R.y, R.x) * (1.0 + 0.03 * sin(uTime * 0.7 + aPhase));
    vec3 world = P.xyz + unit * radius;

    // ─── Реакция на курсор ─────────────────────────────────────
    //
    // Здесь ДВЕ разные силы, и разделены они намеренно.
    //
    // Первая — вмятина под самим курсором: точки рядом с ним
    // расходятся прочь. Это то, что видно, когда курсор идёт
    // по кромке оболочки, и то, что остаётся, когда он оказывается
    // ровно в середине пузыря: там оболочку раздаёт во все стороны.
    //
    // Вторая — сжатие ВСЕЙ оболочки вдоль оси \xabкурсор → центр\xbb:
    // ближняя сторона уходит внутрь, дальняя выпирает, поперёк шар
    // раздаётся. У неё длинный хвост по расстоянию, поэтому далёкий
    // пузырь тоже отзывается. Прежде здесь стоял один колокол
    // exp(-d*d), он падает в ноль уже на паре радиусов — и это
    // читалось как \xabчасть пузырей не реагирует совсем\xbb.
    //
    // Обе силы идут за курсором БЕЗ инерции. Инерция оставлена
    // только сдвигу пузыря целиком, и живёт она в JS.
    float rr   = max(radius, 1.0);
    vec3  toP  = world - uPointer;
    float dp   = length(toP) / rr;
    float dent = exp(-dp * dp * 0.6);

    vec3  cToC = P.xyz - uPointer;
    float lenC = length(cToC);
    float dc   = lenC / rr;
    // Хвост, а не колокол: 1 в середине пузыря, 0.6 на трёх радиусах,
    // 0.14 на десяти. Мёртвых зон по расстоянию нет вовсе.
    float reach = 1.0 / (1.0 + dc * dc * 0.045);
    // При курсоре ровно в центре ось вырождается — и это не ошибка,
    // а нужный случай: axis становится нулевым, side нулевым, и всё
    // сжатие превращается в равномерную раздачу оболочки наружу.
    vec3  axis = cToC / max(lenC, 0.001 * rr);
    float side = dot(unit, axis);
    // Внутри пузыря сжатие гасится: там ось \xabкурсор → центр\xbb почти
    // вырождена, а главное — сжатие тянуло бы ближнюю сторону внутрь
    // ровно там, где вмятина раздаёт её наружу, и две силы гасили бы
    // друг друга. Замер это и показал: отклик в середине просел
    // с 24 % до 10 %.
    // 0.14, а не 0.38. Сжатие вдоль оси — это ровно то, что делает
    // из шара эллипсоид, и при 0.38 пузыри читались эллипсами всё
    // время, пока курсор на первом экране: хвост reach длинный,
    // и сжатие доставало до всех разом.
    //
    // Сила отклика перенесена в ВМЯТИНУ. Она радиальная: когда курсор
    // внутри пузыря, оболочка раздаётся во все стороны одинаково
    // и остаётся шаром, а когда снаружи — проминается с одной стороны.
    // Так отклик заметен, а форма не врёт.
    float k    = reach * uPress * 0.14 * smoothstep(0.15, 1.0, dc);
    vec3  perp = unit - axis * side;
    world += axis * (-side * k * rr) + perp * (k * 0.5 * rr);
    world += normalize(toP + vec3(1e-4)) * dent * uPress * rr * 0.6;

    // Разлёт при лопании: у каждой точки своё направление и своя длина,
    // в том числе по глубине.
    world += spin(aVel, R.y, R.x) * radius * pop;

    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = max(-mv.z, 1.0);

    // Глубина. Перспектива на таком масштабе даёт разницу размера
    // в проценты, этого мало: шар остаётся плоским кольцом. Поэтому
    // ближние точки ЯВНО крупнее и плотнее, дальние мельче и глуше —
    // и по тому, как это переливается при повороте оболочки, видно,
    // что перед тобой шар.
    float near = clamp((uCamZ + radius - depth) / (2.0 * radius), 0.0, 1.0);
    float fade = 1.0 - pop;

    gl_PointSize = aSize * (0.5 + 0.85 * near) * uSizeScale / depth;

    vColor = aTint < 0.5 ? uColorA : (aTint < 1.5 ? uColorB : uColorC);
    vAlpha = (0.14 + 0.42 * near) * uInk * fade * fade;
  }
`,d);if(!U)return null;f.useProgram(U);let I=[r(f,U,"position",R,3),r(f,U,"aVel",E,3),r(f,U,"aSize",T,1),r(f,U,"aTint",z,1),r(f,U,"aPhase",B,1),r(f,U,"aBubble",_,1)],k=f.getUniformLocation(U,"uSizeScale"),O=f.getUniformLocation(U,"uCamZ"),N=f.getUniformLocation(U,"uPointer"),D=f.getUniformLocation(U,"uPress"),H=f.getUniformLocation(U,"uTime"),V=f.getUniformLocation(U,"uInk"),Y=f.getUniformLocation(U,"uColorA"),j=f.getUniformLocation(U,"uColorB"),X=f.getUniformLocation(U,"uColorC"),$=f.getUniformLocation(U,"uPos[0]"),K=f.getUniformLocation(U,"uRot[0]"),Z=f.getUniformLocation(U,"projectionMatrix"),q=f.getUniformLocation(U,"viewMatrix");f.disable(f.DEPTH_TEST),f.enable(f.BLEND),f.blendFuncSeparate(f.SRC_ALPHA,f.ONE_MINUS_SRC_ALPHA,f.ONE,f.ONE_MINUS_SRC_ALPHA);let G=new Float32Array(4*p),W=new Float32Array(4*p),J=()=>{let e=getComputedStyle(document.documentElement);f.useProgram(U),f.uniform1f(V,parseFloat(e.getPropertyValue("--bubbles-ink"))||1);let t=l.map(t=>{let r;return(r=e.getPropertyValue(t).match(/-?[\d.]+/g))&&!(r.length<3)?[r[0]/255,r[1]/255,r[2]/255]:[.5,.5,.5]});f.uniform3fv(Y,t[0]),f.uniform3fv(j,t[1]),f.uniform3fv(X,t[2])},Q=()=>{let t=String(P.filter(e=>!e.gone&&!e.popped).length);e.dataset.bubbles!==t&&(e.dataset.bubbles=t)},ee=(e,t,r)=>{let o=1.7*r;for(let r of b)if(e>r.left-o&&e<r.right+o&&t-o<r.top&&t+o>r.bottom)return!0;return!1},et=(e,t)=>{for(let r=0;r<24;r++){let o=u(w.xmin+1.8*e.r,w.xmax-1.8*e.r),a=u(w.ymin+1.8*e.r,w.ymax-1.8*e.r);if(ee(o,a,e.r)||t&&140>Math.hypot(o-t.x,a-t.y))continue;let n=!1;for(let t of P)if(t!==e&&!t.gone&&Math.hypot(o-t.x,a-t.y)<(e.r+t.r)*1.25){n=!0;break}if(!n||!(r<18)){e.x=o,e.y=a,e.z=u(-(.5*e.r),.5*e.r);return}}e.x=u(w.xmin+1.8*e.r,w.xmax-1.8*e.r),e.y=w.ymax-e.r,e.z=0},er=()=>{let t,r=s.getBoundingClientRect();y=Math.max(1,Math.round(r.left+r.width)),v=Math.max(1,Math.round(r.height)),e.style.left=`${-Math.round(r.left)}px`,e.style.width=`${y}px`,e.style.height=`${v}px`,e.style.visibility="visible",g=Math.min(1,window.devicePixelRatio||1),M=v/2/c,x=o(45,y/v,1,4e3),h=a(M),e.width=Math.round(y*g),e.height=Math.round(v*g),f.viewport(0,0,e.width,e.height),f.useProgram(U),f.uniformMatrix4fv(Z,!1,x),f.uniformMatrix4fv(q,!1,h),t=e.getBoundingClientRect(),b=[(e=>{if(!e)return null;let r=e.getBoundingClientRect();return r.width<1||r.height<1?null:{top:v/2-(r.top-t.top)+10,bottom:v/2-(r.bottom-t.top)-10,left:r.left-t.left-y/2-10,right:r.right-t.left-y/2+10}})(s.querySelector(".hero__lead"))].filter(Boolean);let n=window.innerHeight;for(let e of(w={xmin:-y/2,xmax:y/2,ymin:v/2-Math.min(v,n-r.top),ymax:v/2-Math.max(0,-r.top)},f.uniform1f(k,g*M),f.uniform1f(O,M),P))e.x=Math.max(w.xmin+1.8*e.r,Math.min(w.xmax-1.8*e.r,e.x)),e.y=Math.max(w.ymin+1.8*e.r,Math.min(w.ymax-1.8*e.r,e.y))};for(let e of(er(),J(),P))et(e);Q();let eo=i(1e5,1e5,0),ea=i(1e5,1e5,0),en=0,ei=0,el=(e,t,r,o)=>e+(t-e)*(1-Math.exp(-o/r)),eu=t=>{let r=e.getBoundingClientRect();return{x:t.clientX-r.left-y/2,y:v/2-(t.clientY-r.top)}},ed=t=>{let r=e.getBoundingClientRect();return t.clientX>=r.left&&t.clientX<=r.right&&t.clientY>=r.top&&t.clientY<=r.bottom},es=(e,t)=>{let r=null,o=1/0;for(let a of P){if(a.gone||a.popped)continue;let n=Math.hypot(e-a.x,t-a.y);n<1.05*a.r&&n<o&&(o=n,r=a)}return r},ef=e=>{if(!ed(e))return void em();let{x:t,y:r}=eu(e);eo.x=t,eo.y=r,ea.x>5e4&&(ea.x=eo.x,ea.y=eo.y),ei=1,e.target===s&&(s.style.cursor=es(t,r)?"pointer":"")},em=()=>{ei=0,s.style.cursor=""},ep=e=>{if(!ed(e))return;let t=e.target;if(t?.closest('a, button, input, label, summary, [role="button"], [data-lenis-scrollable]'))return;let{x:r,y:o}=eu(e);eo.x=r,eo.y=o,ea.x>5e4&&(ea.x=eo.x,ea.y=eo.y),ei=1;let a=es(r,o);a&&(a.popped=1e3*n.default.ticker.time,s.style.cursor="",Q())},ec=e=>{"mouse"!==e.pointerType&&em()};window.addEventListener("pointermove",ef,{passive:!0}),window.addEventListener("pointerdown",ep,{passive:!0}),window.addEventListener("pointerup",ec,{passive:!0}),window.addEventListener("pointercancel",ec,{passive:!0}),document.addEventListener("pointerleave",em,{passive:!0});let ex=!0,eh=new IntersectionObserver(([e])=>{ex=e.isIntersecting},{rootMargin:"80px"});eh.observe(s);let ey=0,ev=new MutationObserver(()=>{ey=1e3*n.default.ticker.time+700});ev.observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme"]});let eg=0,eM=0,eb=e=>{let t=1e3*e,r=eg?Math.min(.05,(t-eg)/1e3):0;if(eg=t,ex){t<ey&&(3&eM)==0&&J(),eM++,en=el(en,ei,ei>en?.035:.22,r),ei>0&&(ea.x=el(ea.x,eo.x,.12,r),ea.y=el(ea.y,eo.y,.12,r)),0===ei&&en<.002&&(eo.x=1e5,eo.y=1e5,ea.x=1e5,ea.y=1e5),f.useProgram(U),f.uniform1f(H,t/1e3),f.uniform3f(N,eo.x,eo.y,eo.z),f.uniform1f(D,en);for(let e=0;e<P.length;e++){let o=P[e];if(o.popped&&(o.pop=Math.min(1,(t-o.popped)/760),o.pop>=1&&(o.gone=!0,o.popped=0,A.push(t+u(700,1300)))),!o.gone&&!o.popped){let a=o.dir+Math.sin(t/1e3/o.pa)*o.swayA+Math.sin(t/1e3/o.pb)*o.swayB,n=Math.cos(a)*o.speed,i=Math.sin(a)*o.speed,l=o.x-ea.x,u=o.y-ea.y,d=Math.hypot(l,u);if(d<3.2*o.r&&d>.001){let e=Math.sin(Math.PI*(d/(3.2*o.r)))*en*16;o.vx+=(l/d*e-0)*Math.min(1,1.6*r),o.vy+=(u/d*e-0)*Math.min(1,1.6*r)}o.vx+=(n-o.vx)*Math.min(1,1.6*r),o.vy+=(i-o.vy)*Math.min(1,1.6*r);for(let t=e+1;t<P.length;t++){let e=P[t];if(e.gone||e.popped)continue;let a=o.x-e.x,n=o.y-e.y,i=Math.hypot(a,n),l=(o.r+e.r)*1.4;if(i>l||i<.001)continue;let u=(1-i/l)*42*r;o.vx+=a/i*u,o.vy+=n/i*u,e.vx-=a/i*u,e.vy-=n/i*u}o.x+=o.vx*r,o.y+=o.vy*r,o.ry+=o.wy*r,o.rx+=o.wx*r;let s=1.8*o.r;for(let e of(o.x<w.xmin+s&&(o.x=w.xmin+s,o.dir=Math.PI-o.dir,o.vx=Math.abs(o.vx)),o.x>w.xmax-s&&(o.x=w.xmax-s,o.dir=Math.PI-o.dir,o.vx=-Math.abs(o.vx)),o.y<w.ymin+s&&(o.y=w.ymin+s,o.dir=-o.dir,o.vy=Math.abs(o.vy)),o.y>w.ymax-s&&(o.y=w.ymax-s,o.dir=-o.dir,o.vy=-Math.abs(o.vy)),b)){let t=1.7*o.r,r=e.top+t,a=e.bottom-t;if(o.x<e.left-t||o.x>e.right+t||o.y>=r||o.y<=a)continue;let n=r-o.y,i=o.y-a,l=o.x-(e.left-t),u=Math.min(n,i,l,e.right+t-o.x);u===n?(o.y=r,o.vy=Math.abs(o.vy),o.dir=-o.dir):u===i?(o.y=a,o.vy=-Math.abs(o.vy),o.dir=-o.dir):(u===l?(o.x=e.left-t,o.vx=-Math.abs(o.vx)):(o.x=e.right+t,o.vx=Math.abs(o.vx)),o.dir=Math.PI-o.dir)}}let a=4*e;G[a]=o.x,G[a+1]=o.y,G[a+2]=o.z,G[a+3]=o.gone?1e-4:o.r,W[a]=o.rx,W[a+1]=o.ry,W[a+2]=o.gone?1:o.pop,W[a+3]=0}for(let e=A.length-1;e>=0;e--){if(t<A[e])continue;A.splice(e,1);let r=P.find(e=>e.gone);r&&(C(r),et(r,{x:ea.x,y:ea.y}))}Q(),f.uniform4fv($,G),f.uniform4fv(K,W),f.clearColor(0,0,0,0),f.clear(f.COLOR_BUFFER_BIT),f.drawArrays(f.POINTS,0,L)}};n.default.ticker.add(eb);let ew=new ResizeObserver(er);ew.observe(s);let eP=t=>{t.preventDefault(),n.default.ticker.remove(eb),e.remove()};return e.addEventListener("webglcontextlost",eP),()=>{for(let t of(n.default.ticker.remove(eb),window.removeEventListener("pointermove",ef),window.removeEventListener("pointerdown",ep),window.removeEventListener("pointerup",ec),window.removeEventListener("pointercancel",ec),document.removeEventListener("pointerleave",em),e.removeEventListener("webglcontextlost",eP),ew.disconnect(),eh.disconnect(),ev.disconnect(),s.style.cursor="",I))t&&f.deleteBuffer(t);f.deleteProgram(U);let t=f.getExtension("WEBGL_lose_context");t?.loseContext()}}],49122)}]);