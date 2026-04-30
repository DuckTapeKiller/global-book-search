import { App, Modal, setIcon, ButtonComponent, Notice } from "obsidian";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

export class BarcodeScannerModal extends Modal {
  private html5QrCode: Html5Qrcode | null = null;
  private isScanning = false;
  private currentCameraId: string | null = null;
  private cameras: Array<{ id: string; label: string }> = [];

  constructor(
    app: App,
    private onScan: (isbn: string) => void,
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("book-search-barcode-modal");

    const header = contentEl.createDiv({ cls: "book-search-barcode-header" });
    const iconEl = header.createDiv({ cls: "book-search-barcode-icon" });
    setIcon(iconEl, "scan");
    header.createEl("h2", { text: "Scan ISBN Barcode" });

    const scannerWrapper = contentEl.createDiv({
      cls: "barcode-scanner-wrapper",
    });

    // The video element will be injected here
    scannerWrapper.createDiv({
      cls: "barcode-scanner-container",
      attr: { id: "barcode-reader" },
    });

    // Custom Scanning Guide Line
    scannerWrapper.createDiv({ cls: "barcode-guide-line" });

    const controls = contentEl.createDiv({
      cls: "book-search-barcode-controls",
    });

    const switchBtn = new ButtonComponent(controls)
      .setButtonText("Switch Camera")
      .setClass("mod-secondary")
      .onClick(() => this.switchCamera());

    const cancelBtn = new ButtonComponent(controls)
      .setButtonText("Cancel")
      .onClick(() => this.close());

    try {
      this.cameras = await Html5Qrcode.getCameras();
      if (this.cameras && this.cameras.length > 0) {
        // Prefer back camera ("environment")
        const backCamera = this.cameras.find(
          (c) =>
            c.label.toLowerCase().includes("back") ||
            c.label.toLowerCase().includes("environment"),
        );
        this.currentCameraId = backCamera ? backCamera.id : this.cameras[0].id;

        await this.startScanning();
      } else {
        contentEl.createEl("p", {
          text: "No cameras detected on this device.",
          cls: "error-message",
        });
      }
    } catch (err) {
      console.error("Camera error:", err);
      contentEl.createEl("p", {
        text: "Camera access denied. Please check permissions.",
        cls: "error-message",
      });
    }
  }

  async startScanning() {
    if (!this.currentCameraId) return;

    if (this.html5QrCode) {
      try {
        await this.html5QrCode.stop();
      } catch (err) {
        // ignore
      }
    }

    this.html5QrCode = new Html5Qrcode("barcode-reader");

    const config = {
      fps: 20, // Faster for barcodes
      qrbox: { width: 280, height: 160 },
      aspectRatio: 1.0,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
      ],
    };

    try {
      await this.html5QrCode.start(
        this.currentCameraId,
        config,
        (decodedText) => {
          if (this.isValidISBN(decodedText)) {
            this.onScan(decodedText);
            this.close();
          }
        },
        () => {
          // Silent errors for frame-by-frame failures
        },
      );
      this.isScanning = true;
    } catch (err) {
      new Notice("Could not start camera: " + err);
      console.error(err);
    }
  }

  private isValidISBN(text: string): boolean {
    const clean = text.replace(/[^0-9X]/gi, "");
    return clean.length === 10 || clean.length === 13;
  }

  async switchCamera() {
    if (this.cameras.length < 2) {
      new Notice("Only one camera detected.");
      return;
    }

    const currentIndex = this.cameras.findIndex(
      (c) => c.id === this.currentCameraId,
    );
    const nextIndex = (currentIndex + 1) % this.cameras.length;
    this.currentCameraId = this.cameras[nextIndex].id;

    await this.startScanning();
  }

  async onClose() {
    if (this.html5QrCode) {
      try {
        if (this.isScanning) {
          await this.html5QrCode.stop();
        }
      } catch (err) {
        console.error("Failed to stop scanner:", err);
      }
    }
    this.contentEl.empty();
  }
}
