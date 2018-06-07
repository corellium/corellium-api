class Buttons {
    constructor(instance) {
        this.instance = instance;
        this.pressed = new Set();
        this.touchPosition = null;
    }

    async setPressed(buttons) {
        this.pressed = new Set(buttons);
        await this._update();
    }

    async press(button) {
        this.pressed.add(button);
        await this._update();
    }
    async release(button) {
        this.pressed.delete(button);
        await this._update();
    }
    async pressAndRelease(button) {
        await this.press(button);
        await this.release(button);
    }

    async touch(x, y) {
        this.touchPosition = {x, y};
        this.pressed.add('touch');
        await this._update();
    }
    async releaseTouch() {
        this.touchPosition = null;
        this.pressed.delete('touch');
        await this._update();
    }
    async touchAndRelease(x, y) {
        await this.touch(x, y);
        await this.releaseTouch();
    }

    async _update() {
        await this.instance._fetch('/buttons', {
            method: 'POST',
            json: {
                buttons: [...this.pressed],
                touchPosition: this.touchPosition,
            },
        });
    }
}

module.exports = Buttons;
