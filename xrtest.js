let gl = null;
let xrImmersiveRefSpace = null;
let xrInlineRefSpace = null;

async function viewThread() {
    await navigator.xr.isSessionSupported('inline').then((supported) => {
        if (supported) {
            console.log('supported');
        } else {
            console.log('not supported');
        }
    });
    
    let xrSession;
    await navigator.xr.requestSession('inline').then((session) => {
        xrSession = session;
    });

    xrSession.addEventListener('end', onSessionEnd);
        
    gl = createWebGLContext({
        xrCompatible: true
    });

    document.body.appendChild(gl.canvas);
        
    function onResize() {
        gl.canvas.width = gl.canvas.clientWidth * window.devicePixelRatio;
        gl.canvas.height = gl.canvas.clientHeight * window.devicePixelRatio;
    }
    window.addEventListener('resize', onResize);
    onResize();

    let glLayer = new XRWebGLLayer(xrSession, gl);

    xrSession.updateRenderState({
        baseLayer: glLayer
    });

    xrSession.isImmersive = false;
    let refSpaceType = xrSession.isImmersive ? 'local' : 'viewer';
    await xrSession.requestReferenceSpace(refSpaceType).then((refSpace) => {
        if (xrSession.isImmersive) {
            xrImmersiveRefSpace = refSpace;
          } else {
            xrInlineRefSpace = refSpace;
          }

          xrSession.requestAnimationFrame(onXRFrame);
    });
}

function onXRFrame(t, frame) {
    console.log("on xr frame");
    let session = frame.session;

    let refSpace = session.isImmersive ?
        xrImmersiveRefSpace :
        xrInlineRefSpace;

    let pose = frame.getViewerPose(refSpace);

    session.requestAnimationFrame(onXRFrame);

    let glLayer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    for (let view of pose.views) {
        let viewport = glLayer.getViewport(view);
        gl.viewport(viewport.x, viewport.y,
            viewport.width, viewport.height);

    }
}

function onSessionEnd(session) {
    session.end();
}

function createWebGLContext(glAttribs) {
    glAttribs = glAttribs || {alpha: false};
  
    let webglCanvas = document.createElement('canvas');
    let contextTypes = glAttribs.webgl2 ? ['webgl2'] : ['webgl', 'experimental-webgl'];
    let context = null;
  
    for (let contextType of contextTypes) {
      context = webglCanvas.getContext(contextType, glAttribs);
      if (context) {
        break;
      }
    }
  
    if (!context) {
      let webglType = (glAttribs.webgl2 ? 'WebGL 2' : 'WebGL');
      console.error('This browser does not support ' + webglType + '.');
      return null;
    }
  
    return context;
  }

  viewThread();