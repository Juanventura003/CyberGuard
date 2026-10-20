import { Component, type ReactNode } from "react";
/** Keeps navigation available if a route fails to render or its lazy module cannot load. */
export default class PageErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="route-loading" role="alert">
          <h1>This page couldn’t load.</h1>
          <p>
            Reload the page to try again, or use the navigation to open another
            page.
          </p>
          <button onClick={() => window.location.reload()}>Reload page</button>
        </div>
      );
    return this.props.children;
  }
}
