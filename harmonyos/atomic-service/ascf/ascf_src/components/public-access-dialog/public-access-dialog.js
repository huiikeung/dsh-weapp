Component({
  properties: {
    visible: { type: Boolean, value: false },
    dialog: { type: Object, value: null },
    theme: { type: String, value: 'light' }
  },
  methods: {
    noop() {},
    confirm() { this.triggerEvent('confirm'); }
  }
});
