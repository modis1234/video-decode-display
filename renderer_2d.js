class Canvas2DRenderer {
  #canvas = null;
  #ctx = null;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d");
    console.log("canvas:", canvas);
  }

  draw(frame) {
    console.log("frame:", frame.displayWidth, frame.displayHeight);
    this.#canvas.width = frame.displayWidth;
    this.#canvas.height = frame.displayHeight;
    this.#ctx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
    frame.close();
  }
}
