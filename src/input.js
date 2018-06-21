const BUTTONS = {
    'home': 4,
    'power': 8,
    'volume-up': 16,
    'volume-down': 32,
    'ringer': 64,
};
function buttonId(button) {
    if (!(button in BUTTONS))
        throw new Error(`invalid button ${button}`);
    return BUTTONS[button];
}
const TOUCH = 1;

class Input {
    constructor() {
        this.points = [];
        this.pressed = 0;
        this._delay = 0;
    }
    _addPoint(point = {}) {
        point.buttons = this.pressed;
        if (this._delay != 0)
            point.delay = this._delay;
        this.points.push(point);
        this._delay = 0;
        return this;
    }

    press(...buttonNames) {
        buttonNames.forEach(button => {
            this.pressed |= buttonId(button);
        });
        return this._addPoint();
    }

    release(...buttonNames) {
        buttonNames.forEach(button => {
            this.pressed &= ~buttonId(button);
        });
        return this._addPoint();
    }

    delay(delay) {
        this._delay = delay;
        return this;
    }

    pressRelease(button, delay=100) {
        return this.press(button).delay(delay).release(button);
    }

    touch(x, y) {
        this.pressed |= TOUCH;
        return this._addPoint({pos: [x, y]});
    }

    touchUp() {
        this.pressed &= ~TOUCH;
        return this._addPoint();

    }

    swipeTo(x, y, curve) {
        if (!(this.pressed & TOUCH))
            throw new Error('touch must be down to swipe');
        return this._addPoint({pos: [x, y], curve});
    }

    tap(x, y, delay=100) {
        this.touch(x, y).delay(delay).touchUp();
    }
}

// instead of writing new Input().doThing(), you can write I.doThing()
// examples:
// I.press('home').delay(250).release('home')
// I.touch(100, 100).delay(250).swipeTo(200, 200).touchUp()
const I = new Proxy({}, {
    get(target, prop) {
        return function(...args) {
            return new Input()[prop](...args);
        };
    }
});

module.exports = {Input, I};
