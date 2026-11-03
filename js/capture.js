/**
 * Photo composition exporter and bounded 8-photo in-memory tray manager.
 * Exports the exact mirrored stage composition (excluding UI and tracking cursors)
 * with a crisp picnic Polaroid border and handwritten local date.
 */

export class PhotoTrayManager {
  constructor(maxPhotos = 8) {
    this.maxPhotos = maxPhotos;
    this.photos = [];
  }

  isFull() {
    return this.photos.length >= this.maxPhotos;
  }

  /**
   * Renders the stage canvas into a framed picnic print and returns a Blob + Object URL.
   */
  async captureFramedBlob(stageCanvas, includeDate = true) {
    const pad = 28;
    const bottomPad = 78;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = stageCanvas.width + pad * 2;
    exportCanvas.height = stageCanvas.height + pad + bottomPad;
    const ctx = exportCanvas.getContext('2d');

    // Cool frost-white Polaroid frame
    ctx.fillStyle = '#F4F8F9';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Subtle picnic gingham accent line along bottom
    ctx.fillStyle = '#7FC8C2';
    ctx.fillRect(pad, exportCanvas.height - bottomPad + 6, stageCanvas.width, 3);

    // Draw the locked composition
    ctx.drawImage(stageCanvas, pad, pad);

    if (includeDate) {
      const dateStr = new Date().toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      ctx.fillStyle = '#1F3038';
      ctx.font = 'bold 30px Caveat, cursive';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `Picnic Glass • ${dateStr}`,
        exportCanvas.width - pad - 6,
        exportCanvas.height - bottomPad * 0.45
      );
    }

    return new Promise((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Canvas export failed'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const item = {
          id: `picnic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          url,
          blob,
          createdAt: new Date()
        };
        let evicted = null;
        if (this.photos.length >= this.maxPhotos) {
          evicted = this.photos.shift();
          URL.revokeObjectURL(evicted.url);
        }
        this.photos.push(item);
        resolve({ item, evicted });
      }, 'image/png');
    });
  }

  removePhoto(id) {
    const idx = this.photos.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const [removed] = this.photos.splice(idx, 1);
      URL.revokeObjectURL(removed.url);
      return true;
    }
    return false;
  }

  clearAll() {
    for (const p of this.photos) {
      URL.revokeObjectURL(p.url);
    }
    this.photos.length = 0;
  }
}
