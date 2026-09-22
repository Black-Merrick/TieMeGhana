import { Component } from "react";

/**
 * Keeps a screen that fails from taking the whole app, and the visit, with it.
 *
 * Without one, an error while a screen renders unmounts everything above it.
 * On the doctor's device that is the connection to the patient's phone, so a
 * fault in one screen blanked the page and told the phone the consultation had
 * ended, when nothing had ended. Here the fault stays where it happened: the
 * screen is replaced by a message that says what to do, the connection and the
 * visit carry on behind it, and the error's own words are kept on screen so a
 * report of it says what actually went wrong.
 *
 * `resetKey` clears the error when it changes, so moving to another screen is
 * a fresh start. `onBack`, when given, is a way out to the screen before.
 * See ADR 053.
 */
export default class ScreenErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error, info) {
    // Kept in the console as well, with the component stack, for whoever is
    // looking into it.
    console.error("A screen failed to render", error, info?.componentStack);
  }

  tryAgain = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { title = "This screen could not open", keepsVisit = false, onBack = null, backLabel = "Go back", reloadable = false } = this.props;

    return (
      <section
        className="pairing pairing--card screen-error"
        role="alert"
        data-testid="screen-error"
      >
        <h2 className="pairing__title">{title}</h2>
        <p className="pairing__hint">
          {keepsVisit
            ? "The visit is still going and the patient's phone has not been disconnected. Try again, or go back."
            : "Nothing has been lost. Try again."}
        </p>

        <div className="pairing__actions">
          <button
            type="button"
            className="pairing__primary"
            onClick={reloadable ? () => window.location.reload() : this.tryAgain}
            data-testid="screen-error-retry"
          >
            {reloadable ? "Reload this page" : "Try again"}
          </button>
          {onBack ? (
            <button
              type="button"
              className="pairing__secondary"
              onClick={() => {
                this.tryAgain();
                onBack();
              }}
              data-testid="screen-error-back"
            >
              {backLabel}
            </button>
          ) : null}
        </div>

        <details className="screen-error__details">
          <summary>Details for whoever is looking into it</summary>
          <code data-testid="screen-error-message">
            {error?.name ? `${error.name}: ` : ""}
            {error?.message ?? String(error)}
          </code>
        </details>
      </section>
    );
  }
}
