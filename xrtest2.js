import {WebXRButton} from './js/util/webxr-button.js';
import {Scene, WebXRView} from './js/render/scenes/scene.js';
import {Renderer, createWebGLContext} from './js/render/core/renderer.js';
import {Gltf2Node} from './js/render/nodes/gltf2.js';
import {SkyboxNode} from './js/render/nodes/skybox.js';
import {InlineViewerHelper} from './js/util/inline-viewer-helper.js';
import {QueryArgs} from './js/util/query-args.js';
import {SevenSegmentText} from './js/render/nodes/seven-segment-text.js';
import {mat4} from './js/third-party/gl-matrix/src/gl-matrix.js';

// If requested, use the polyfill to provide support for mobile devices
// and devices which only support WebVR.
import WebXRPolyfill from './js/third-party/webxr-polyfill/build/webxr-polyfill.module.js';
let polyfill = new WebXRPolyfill();

// XR globals.
let xrButton = null;
let xrImmersiveRefSpace = null;
let inlineViewerHelper = null;

let video = document.createElement('video');
video.loop = true;
video.src = 'https://media.githubusercontent.com/media/nickwn/VROnFire/gh-pages/media/PRICE_ForDataOverlay_360_injected.mp4';
video.crossOrigin = 'anonymous';
let videoEpochTime = 0;
let sensorData = {};
let isVideoPlaying = false;
let sensorDataTexts = {};
let hasIgnitionStarted = false;
let hasFireFinished = false;
//video.play();

// WebGL scene globals.
let gl = null;
let renderer = null;
let scene = new Scene();
scene.addNode(new SkyboxNode({
    displayMode: 'mono',
    isVideo: true,
    videoElem: video
}));

//let text1 = new SevenSegmentText();
//text1.matrix = new Float32Array([
//    0.075, 0, 0, 0,
//    0, 0.075, 0, 0,
//    0, 0, 1, 0,
//    0, -0.3, -0.5, 1,
//]);
//scene.addNode(text1);

function makeRequest(method, url) {
    return new Promise(function (resolve, reject) {
        let xhr = new XMLHttpRequest();
        xhr.open(method, url);
        xhr.onload = function () {
            if (this.status >= 200 && this.status < 300) {
                resolve(xhr.response);
            } else {
                reject({
                    status: this.status,
                    statusText: xhr.statusText
                });
            }
        };
        xhr.onerror = function () {
            reject({
                status: this.status,
                statusText: xhr.statusText
            });
        };
        xhr.send();
    });
}

function parseCSV(text) {
    const lines = text.split('\n');

    const labelLine = lines.slice(0, 1)[0];
    const labels = labelLine.split(',');

    const dataLines = lines.slice(1);
    let data = {};
    for(let i = 0; i < dataLines.length; i++) {
        const dataLine = dataLines[i];
        const vals = dataLine.split(',');
        for(let j = 0; j < vals.length; j++) {
            if(!(labels[j] in data)) {
                data[labels[j]] = [];
            }
            data[labels[j]].push(vals[j]);
        }
    }

    return data;
}

function kindaFindKey(key, dict) {
    for(const dictKey in dict) {
        if(dictKey.includes(key)) {
            return dictKey;
        }
    }
    return '';
}

async function parseDataSet(path) {
    const channelsText = await makeRequest('GET', path + 'RoomFire_Channels.csv');
    const channels = parseCSV(channelsText);
    const dataText = await makeRequest('GET', path + 'RoomFire_ScaledData.csv');
    sensorData = parseCSV(dataText);

    const channelsToTrack = ['TC0_Amb', 'TC1_S1', 'TC2_S2', 'TC3', 'TC4', 'TC5_P2', 'TC6_P3', 
        'TC7_M1R', 'TC8_M2R', 'Heat Release Rate'];

    const channelValDrawLocs = {
        //'TC0_Amb': [0.0, 1.0, -1.0],
        'TC1_S1': [-0.05, 1.5, -0.1],
        'TC2_S2': [0.3, 1.5, 0.5],
        'TC3': [0.2, 1.5, 0.2],
        'TC4': [0.1, 0.1, 1.0],
        'TC5_P2': [0.7, 0.05, 1.0],
        'TC6_P3': [-1.0, 0.3, 0.7],
        'TC7_M1R': [-1.0, 0.0, -1.0],
        'TC8_M2L': [1.0, 0.0, 0.0]
    }

    const textScale = [0.025, 0.025];
    const origin = new Float32Array([0.0, 0.0, 0.0]);
    const up = new Float32Array([0.0, 1.0, 0.0]);
    for(const channelName in channelValDrawLocs) {
        const channelTextTransf = channelValDrawLocs[channelName];

        const translation = new Float32Array(channelTextTransf);
        let textMat = mat4.create();
        mat4.targetTo(textMat, origin, translation, up);
        mat4.scale(textMat, textMat, new Float32Array([textScale[0], textScale[1], 1.0]));
        textMat[12] = translation[0];
        textMat[13] = translation[1];
        textMat[14] = translation[2];
        //mat4.translate(textMat, textMat, translation);
        console.log(textMat);
        sensorDataTexts[channelName] = new SevenSegmentText();
        sensorDataTexts[channelName].matrix = textMat;
        scene.addNode(sensorDataTexts[channelName]);
    }

    const updateInterval = 500;
    const epochTimes = sensorData['NTP Epoch Time (s)'];
    for(const channelName in channelValDrawLocs) {
        const kindaKey = kindaFindKey(channelName, sensorData);
        const channelData = sensorData[kindaKey];
        setInterval(() => {
            if(isVideoPlaying) {
                let highIdxBound = 0;
                while(highIdxBound < epochTimes.length && epochTimes[highIdxBound] < videoEpochTime) {
                    highIdxBound++;
                }

                if(highIdxBound == 0) {
                    return; // early out
                }

                const lowIdxBound = highIdxBound - 1;
                const interpAlpha = (videoEpochTime - epochTimes[lowIdxBound]) / 
                    (epochTimes[highIdxBound] - epochTimes[lowIdxBound]);
                const interpChannelVal = parseFloat(channelData[lowIdxBound]) + 
                    interpAlpha * (parseFloat(channelData[highIdxBound]) - parseFloat(channelData[lowIdxBound]));

                sensorDataTexts[channelName].text = interpChannelVal.toFixed(2);
                //console.log(channelName + ': ' + interpChannelVal)
            }
        }, updateInterval);
    }

    console.log(sensorData);
    //return data;
}

function onPlay() {
    videoEpochTime = 1537970781; // when camera starts recording (in RoomFire_UserEvents.csv)
    video.play();
    isVideoPlaying = true;
    hasIgnitionStarted = false;
    hasFireFinished = false;
}

function initXR() {
    xrButton = new WebXRButton({
        onRequestSession: onRequestSession,
        onEndSession: onEndSession
    });
    document.querySelector('header').appendChild(xrButton.domElement);
    document.querySelector('#play').addEventListener('click', onPlay);

    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        xrButton.enabled = supported;
        });

        navigator.xr.requestSession('inline').then(onSessionStarted);
    }

    parseDataSet('data/');
    setInterval(()=>{
        if(isVideoPlaying) {
            videoEpochTime = 1537970781 + video.currentTime;
        }
    }, 10);
}

function initGL() {
    if (gl)
        return;

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

    renderer = new Renderer(gl);
    scene.setRenderer(renderer);
}

function onRequestSession() {
    return navigator.xr.requestSession('immersive-vr').then((session) => {
        xrButton.setSession(session);
        session.isImmersive = true;
        onSessionStarted(session);
    });
}

function onSessionStarted(session) {
    session.addEventListener('end', onSessionEnded);

    initGL();
    scene.inputRenderer.useProfileControllerMeshes(session);

    let glLayer = new XRWebGLLayer(session, gl);
    session.updateRenderState({ baseLayer: glLayer });

    // When rendering 360 photos/videos you want to ensure that the user's
    // head is always at the center of the rendered media. Otherwise users
    // with 6DoF hardware could walk towards the edges and see a very skewed
    // or outright broken view of the image. To prevent that, we request a
    // 'position-disabled' reference space, which suppresses any positional
    // information from the headset. (As an added bonus this mode may be
    // more power efficient on some hardware!)
    let refSpaceType = session.isImmersive ? 'local' : 'viewer';
    session.requestReferenceSpace(refSpaceType).then((refSpace) => {
        if (session.isImmersive) {
        xrImmersiveRefSpace = refSpace;
        } else {
        inlineViewerHelper = new InlineViewerHelper(gl.canvas, refSpace);
        }
        session.requestAnimationFrame(onXRFrame);
    });
}

function onEndSession(session) {
    session.end();
}

function onSessionEnded(event) {
    if (event.session.isImmersive) {
        xrButton.setSession(null);
    }
}

function onXRFrame(t, frame) {
    let session = frame.session;
    let refSpace = session.isImmersive ?
                        xrImmersiveRefSpace :
                        inlineViewerHelper.referenceSpace;
    let pose = frame.getViewerPose(refSpace);
    //let textCtx = gl.canvas.getContext('2d');

    scene.startFrame();

    session.requestAnimationFrame(onXRFrame);

    let glLayer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    if (pose) {
        let views = [];
        for (let view of pose.views) {
            let renderView = new WebXRView(view, glLayer);

            // It's important to take into account which eye the view is
            // associated with in cases like this, since it informs which half
            // of the stereo image should be used when rendering the view.
            renderView.eye = view.eye
            views.push(renderView);
        }

        scene.updateInputSources(frame, refSpace);

        scene.drawViewArray(views);
    }

    scene.endFrame();

    if (!hasIgnitionStarted && videoEpochTime > 1537971142) {
        console.log('ignition started');
        hasIgnitionStarted = true;
    }// ignition start
    if (!hasFireFinished && videoEpochTime > 1537971142) {
        console.log('fire finished');
        hasFireFinished = true;
    }// ignition start

}

// Start the XR application.
initXR();