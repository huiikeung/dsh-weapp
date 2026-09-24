const store = require('../../utils/store');
const theme = require('../../utils/theme');

Page({
  data: {
    workspaces: [],
    currentId: ''
  },

  onLoad() {
    theme.applyTo(this);
    this.unsubscribe = store.subscribe((snapshot) => {
      this.setData({
        workspaces: snapshot.app.workspaces || [],
        currentId: snapshot.app.currentWorkspaceId || ''
      });
    });
    this.setData({
      workspaces: store.state.workspaces || [],
      currentId: store.state.currentWorkspaceId || ''
    });
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  selectWorkspace(e) {
    store.setCurrentWorkspace(e.currentTarget.dataset.id);
    wx.navigateBack();
  },

  browseDirectory() {
    wx.navigateTo({ url: '/pages/files/files?mode=picker' });
  }
});
