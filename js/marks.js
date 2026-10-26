/**
 * Surface glass lipstick/jam layer, picnic stamps, and bounded undo history.
 * Marks sit on the glass and survive fog evaporation.
 */

export class MarksLayer {
  constructor(width = 1280, height = 720, maxUndo = 10) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.maxUndo = maxUndo;
    this.undoStack = [];
  }

  resize(newWidth, newHeight) {
    if (newWidth === this.canvas.width && newHeight === this.canvas.height) return;
    const temp = document.createElement('canvas');
    temp.width = this.canvas.width;
    temp.height = this.canvas.height;
    temp.getContext('2d').drawImage(this.canvas, 0, 0);

    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    this.ctx.drawImage(temp, 0, 0, newWidth, newHeight);
  }

  pushUndo(fogSnapshot = null) {
    const img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this.undoStack.push({
      marksImage: img,
      fogSnapshot: fogSnapshot ? new Float32Array(fogSnapshot) : null
    });
    if (this.undoStack.length > this.maxUndo) {
      this.undoStack.shift();
    }
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  popUndo(fogEngine = null) {
    if (!this.canUndo()) return false;
    const state = this.undoStack.pop();
    if (state.marksImage) {
      this.ctx.putImageData(state.marksImage, 0, 0);
    }
    if (state.fogSnapshot && fogEngine) {
      fogEngine.restoreDensity(state.fogSnapshot);
    }
    return true;
  }

  drawLipstickSegment(x0, y0, x1, y1, color = '#E63946', radius = 12) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = radius * 1.8;
    ctx.globalAlpha = 0.88;

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // Subtle waxy highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = radius * 0.45;
    ctx.beginPath();
    ctx.moveTo(x0 - 2, y0 - 2);
    ctx.lineTo(x1 - 2, y1 - 2);
    ctx.stroke();
    ctx.restore();
  }

  placeStamp(x, y, stampType = 'kiss', color = '#E63946', size = 46) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.35);

    if (stampType === 'kiss') {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.86;
      // Upper lip arches
      ctx.beginPath();
      ctx.arc(-size * 0.22, -size * 0.1, size * 0.26, Math.PI, 0, false);
      ctx.arc(size * 0.22, -size * 0.1, size * 0.26, Math.PI, 0, false);
      ctx.quadraticCurveTo(0, size * 0.06, -size * 0.48, -size * 0.1);
      ctx.fill();
      // Lower lip
      ctx.beginPath();
      ctx.moveTo(-size * 0.46, 0);
      ctx.quadraticCurveTo(0, size * 0.55, size * 0.46, 0);
      ctx.quadraticCurveTo(0, size * 0.12, -size * 0.46, 0);
      ctx.fill();
    } else {
      const emoji = stampType === 'berry' ? '🍓' : '🌼';
      ctx.font = `${Math.round(size * 1.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, 0, 0);
    }

    ctx.restore();
  }

  wipeSegment(x0, y0, x1, y1, radius = 34) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineWidth = radius * 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  clearAll() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
