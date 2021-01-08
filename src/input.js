const BUTTONS = {
  home: 4,
  power: 8,
  "volume-up": 16,
  "volume-down": 32,
  ringer: 64,
};
function buttonId(button) {
  if (!(button in BUTTONS)) throw new Error(`invalid button ${button}`);
  return BUTTONS[button];
}
const TOUCH = 1;

/**
 * An input to send to an instance.
 *
 * Inputs consist of a series of steps. Each method in this class adds a step
 * to the current input, and returns the current for chaining.
 *
 * As a shortcut for `new Input().doThing()`, there is a global called `{@link
 * I}`. It's a strange object for which `I.doThing()` gives the same result as
 * `new Input().doThing()`.
 *
 * @example
 * const input = new Input().pressRelease('home').tap(100, 100);
 * // using the I shortcut
 * const input2 = I.pressRelease('home').tap(100, 100);
 */
class Input {
  /**
   * The name of a button. Possible values are:
   *
   * Button|Description
   * -|-
   * `'home'`|Home button
   * `'power'`|Power button
   * `'volume-up'`|Volume up button
   * `'volume-down'`|Volume down button
   * `'ringer'`|Ringer switch
   * @typedef {string} Input~ButtonName
   */

  /**
   * Creates a new input with no steps. It's usually more convenient to use
   * `{@link I}` instead.
   */
  constructor() {
    this.points = [];
    this.pressed = 0;
    this._delay = 0;
  }
  _addPoint(point = {}) {
    point.buttons = this.pressed;
    if (this._delay != 0) point.delay = this._delay;
    this.points.push(point);
    this._delay = 0;
    return this;
  }

  /**
   * Add a step to press and hold the specified buttons.
   * @param {...Input~ButtonName} buttonNames - Names of buttons to press.
   * @returns this
   */
  press(...buttonNames) {
    buttonNames.forEach((button) => {
      this.pressed |= buttonId(button);
    });
    return this._addPoint();
  }

  /**
   * Add a step to release the specified buttons.
   * @param {...Input~ButtonName} buttonNames - Names of buttons to release.
   * @returns this
   */
  release(...buttonNames) {
    buttonNames.forEach((button) => {
      this.pressed &= ~buttonId(button);
    });
    return this._addPoint();
  }

  /**
   * Add a step to delay by the specified number of milliseconds.
   * @param {number} [delay=100] - The number of milliseconds to delay.
   * @returns this
   */
  delay(delay) {
    this._delay = delay;
    return this;
  }

  /**
   * Add steps to press the specified button, delay for an interval
   * defaulting to 100 milliseconds, and release the specified button.
   * @param {Input~ButtonName} button - The button to press and release.
   * @param {number} [delay=100] The number of milliseconds to hold down the button.
   * @returns this
   */
  pressRelease(button, delay = 100) {
    return this.press(button).delay(delay).release(button);
  }

  /**
   * Add a step to set the current touch position and start touching the screen.
   * @param {number} x - The x coordinate.
   * @param {number} y - The y coordinate.
   * @return this
   */
  touch(x, y) {
    this.pressed |= TOUCH;
    return this._addPoint({ pos: [x, y] });
  }

  /**
   * Add a step to release the touchscreen.
   * @return this
   */
  touchUp() {
    this.pressed &= ~TOUCH;
    return this._addPoint();
  }

  /**
   * Add a step to swipe from the current touch position to the specified
   * position. Bezier control points may be specified. If there is a delay
   * step immediately before this one, the swipe will take place over the
   * delay; otherwise it will happen instantly.
   * @param {number} x - The x coordinate to swipe to.
   * @param {number} y - The y coordinate to swipe to.
   * @param {point[]} [curve] - An array of Bezier control points. Each
   * point is a two-element array containing an x coordinate and a y
   * coordinate.
   */
  swipeTo(x, y, curve) {
    if (!(this.pressed & TOUCH)) throw new Error("touch must be down to swipe");
    return this._addPoint({ pos: [x, y], curve });
  }

  /**
   * Add steps to touch the screen at the given position, delay for an
   * interval defaulting to 100 milliseconds, and release the touchscreen.
   * @param {number} x - The x coordinate.
   * @param {number} y - The y coordinate.
   * @param {number} [delay=100] The number of milliseconds to hold down the touch.
   */
  tap(x, y, delay = 100) {
    return this.touch(x, y).delay(delay).touchUp();
  }
}

/**
 * A magic object that can be used as a shortcut for `new Input()` in
 * expressions like `new Input().pressRelease('home')`.
 * @see Input
 * @constant
 * @example
 * I.press('home').delay(250).release('home')
 * I.touch(100, 100).delay(250).swipeTo(200, 200).touchUp()
 */
const I = new Proxy(
  {},
  {
    get(target, prop) {
      return function (...args) {
        return new Input()[prop](...args);
      };
    },
  }
);

module.exports = { Input, I };
