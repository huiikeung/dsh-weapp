@Component
export struct ConversationViewport {
  @BuilderParam content: () => void;
  @Prop itemCount: number = 0;
  private scroller: Scroller = new Scroller();
  stickToBottom(): void { this.scroller.scrollEdge(Edge.Bottom); }
  build() { Scroll(this.scroller) { this.content() }.width('100%').layoutWeight(1).scrollBar(BarState.Off) }
}
