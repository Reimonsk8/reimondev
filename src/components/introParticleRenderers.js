export const MAX_CONNECTIONS = 12000;
export const LINE_BUCKETS = 5;

export const createCanvas2DRenderer = (canvas) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  return {
    gpuStatus: 'browser-managed',
    resize(width, height, scale = 1) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    },
    clear(width, height) {
      ctx.clearRect(0, 0, width, height);
    },
    drawParticles(xs, ys, sizes, count) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const size = sizes[i];
        ctx.moveTo(xs[i] + size, ys[i]);
        ctx.arc(xs[i], ys[i], size, 0, Math.PI * 2);
      }
      ctx.fill();
    },
    drawLines(lines, count) {
      if (!count) return;
      ctx.lineWidth = 1;
      for (let bucket = 1; bucket <= LINE_BUCKETS; bucket++) {
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const offset = i * 5;
          if (lines[offset + 4] !== bucket) continue;
          ctx.moveTo(lines[offset], lines[offset + 1]);
          ctx.lineTo(lines[offset + 2], lines[offset + 3]);
        }
        ctx.strokeStyle = `rgba(255, 255, 255, ${(bucket / LINE_BUCKETS).toFixed(2)})`;
        ctx.stroke();
      }
    },
    destroy() {},
  };
};

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

export const createWebGLRenderer = (canvas, particleCapacity) => {
  let gl;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false });
  } catch (_) {
    return null;
  }
  if (!gl) return null;
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuRenderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  const gpuStatus = /swiftshader|llvmpipe|softpipe|software/i.test(gpuRenderer)
    ? 'software'
    : debugInfo
      ? 'hardware-reported'
      : 'unknown';

  const particleVertexShader = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    in vec2 a_corner;
    in vec2 a_center;
    in float a_size;
    in float a_alpha;
    uniform vec2 u_resolution;
    out vec2 v_local;
    out float v_alpha;
    void main() {
      vec2 pixel = a_center + a_corner * a_size;
      vec2 clip = (pixel / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      v_local = a_corner;
      v_alpha = a_alpha;
    }
  `);
  const particleFragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    in vec2 v_local;
    in float v_alpha;
    out vec4 outColor;
    void main() {
      float radius = length(v_local);
      if (radius > 1.0) discard;
      float edge = 1.0 - smoothstep(0.88, 1.0, radius);
      outColor = vec4(1.0, 1.0, 1.0, v_alpha * edge);
    }
  `);
  const lineVertexShader = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    in vec2 a_position;
    in float a_alpha;
    uniform vec2 u_resolution;
    out float v_alpha;
    void main() {
      vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      v_alpha = a_alpha;
    }
  `);
  const lineFragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    in float v_alpha;
    out vec4 outColor;
    void main() { outColor = vec4(1.0, 1.0, 1.0, v_alpha); }
  `);

  const linkProgram = (vertex, fragment) => {
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }
    const linked = gl.createProgram();
    if (!linked) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return null;
    }
    gl.attachShader(linked, vertex);
    gl.attachShader(linked, fragment);
    gl.linkProgram(linked);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
      gl.deleteProgram(linked);
      return null;
    }
    return linked;
  };

  const particleProgram = linkProgram(particleVertexShader, particleFragmentShader);
  const lineProgram = linkProgram(lineVertexShader, lineFragmentShader);
  if (!particleProgram || !lineProgram) {
    if (particleProgram) gl.deleteProgram(particleProgram);
    if (lineProgram) gl.deleteProgram(lineProgram);
    return null;
  }

  const particleCornerBuffer = gl.createBuffer();
  const particleInstanceBuffer = gl.createBuffer();
  const lineBuffer = gl.createBuffer();
  if (!particleCornerBuffer || !particleInstanceBuffer || !lineBuffer) {
    [particleCornerBuffer, particleInstanceBuffer, lineBuffer].forEach((item) => {
      if (item) gl.deleteBuffer(item);
    });
    gl.deleteProgram(particleProgram);
    gl.deleteProgram(lineProgram);
    return null;
  }

  const corners = new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
  ]);
  const particleData = new Float32Array(particleCapacity * 4);
  const lineData = new Float32Array(MAX_CONNECTIONS * 6);
  const particleLocations = {
    corner: gl.getAttribLocation(particleProgram, 'a_corner'),
    center: gl.getAttribLocation(particleProgram, 'a_center'),
    size: gl.getAttribLocation(particleProgram, 'a_size'),
    alpha: gl.getAttribLocation(particleProgram, 'a_alpha'),
    resolution: gl.getUniformLocation(particleProgram, 'u_resolution'),
  };
  const lineLocations = {
    position: gl.getAttribLocation(lineProgram, 'a_position'),
    alpha: gl.getAttribLocation(lineProgram, 'a_alpha'),
    resolution: gl.getUniformLocation(lineProgram, 'u_resolution'),
  };

  gl.bindBuffer(gl.ARRAY_BUFFER, particleCornerBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, particleInstanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, particleData.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, lineData.byteLength, gl.DYNAMIC_DRAW);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  return {
    gpuRenderer,
    gpuStatus,
    resize(width, height, scale = 1) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(particleProgram);
      gl.uniform2f(particleLocations.resolution, width, height);
      gl.useProgram(lineProgram);
      gl.uniform2f(lineLocations.resolution, width, height);
    },
    clear() {
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    drawParticles(xs, ys, sizes, count) {
      for (let i = 0; i < count; i++) {
        const offset = i * 4;
        particleData[offset] = xs[i];
        particleData[offset + 1] = ys[i];
        particleData[offset + 2] = sizes[i];
        particleData[offset + 3] = 1;
      }

      gl.useProgram(particleProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, particleCornerBuffer);
      gl.enableVertexAttribArray(particleLocations.corner);
      gl.vertexAttribPointer(particleLocations.corner, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(particleLocations.corner, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, particleInstanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, particleData, 0, count * 4);
      const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
      gl.enableVertexAttribArray(particleLocations.center);
      gl.vertexAttribPointer(particleLocations.center, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(particleLocations.center, 1);
      gl.enableVertexAttribArray(particleLocations.size);
      gl.vertexAttribPointer(particleLocations.size, 1, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
      gl.vertexAttribDivisor(particleLocations.size, 1);
      gl.enableVertexAttribArray(particleLocations.alpha);
      gl.vertexAttribPointer(particleLocations.alpha, 1, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
      gl.vertexAttribDivisor(particleLocations.alpha, 1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    },
    drawLines(lines, count) {
      const lineCount = Math.min(count, MAX_CONNECTIONS);
      if (!lineCount) return;
      for (let i = 0; i < lineCount; i++) {
        const src = i * 5;
        const dst = i * 6;
        const alpha = lines[src + 4] / LINE_BUCKETS;
        lineData[dst] = lines[src];
        lineData[dst + 1] = lines[src + 1];
        lineData[dst + 2] = alpha;
        lineData[dst + 3] = lines[src + 2];
        lineData[dst + 4] = lines[src + 3];
        lineData[dst + 5] = alpha;
      }
      gl.useProgram(lineProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData, 0, lineCount * 6);
      const stride = 3 * Float32Array.BYTES_PER_ELEMENT;
      gl.enableVertexAttribArray(lineLocations.position);
      gl.vertexAttribPointer(lineLocations.position, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(lineLocations.position, 0);
      gl.enableVertexAttribArray(lineLocations.alpha);
      gl.vertexAttribPointer(lineLocations.alpha, 1, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
      gl.vertexAttribDivisor(lineLocations.alpha, 0);
      gl.drawArrays(gl.LINES, 0, lineCount * 2);
    },
    destroy() {
      gl.deleteBuffer(particleCornerBuffer);
      gl.deleteBuffer(particleInstanceBuffer);
      gl.deleteBuffer(lineBuffer);
      gl.deleteProgram(particleProgram);
      gl.deleteProgram(lineProgram);
    },
  };
};
