import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Bug, MessageCircle, Rocket, X } from "lucide";
import { GITHUB_URL } from "../config.js";
import { icon } from "../utils/icons.js";
import "./ui/dialog.js";
import "./ui/input.js";

type FeedbackType = "bug" | "feature" | "other";
type SubmitStatus = "idle" | "sending" | "success" | "error";

@customElement("feedback-modal")
export class FeedbackModal extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@state() private open = false;
	@state() private feedbackType: FeedbackType = "bug";
	@state() private message = "";
	@state() private status: SubmitStatus = "idle";

	override connectedCallback() {
		super.connectedCallback();
		window.addEventListener("speeedy:open-feedback", this.handleOpen);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener("speeedy:open-feedback", this.handleOpen);
	}

	private handleOpen = () => {
		this.open = true;
		this.status = "idle";
		this.message = "";
		this.feedbackType = "bug";

		setTimeout(() => this.querySelector("textarea")?.focus(), 150);
	};

	private hide = () => {
		this.open = false;
	};

	// No third-party form service: feedback opens a prefilled issue in the GitHub fork,
	// so nothing is sent until the user submits it there.
	private handleSubmit(e: Event) {
		e.preventDefault();
		if (!this.message.trim()) return;

		const params = new URLSearchParams({
			title: `[${this.feedbackType}] ${this.message.trim().split("\n")[0].slice(0, 80)}`,
			body: this.message.trim(),
		});
		window.open(`${GITHUB_URL}/issues/new?${params}`, "_blank", "noopener");
		this.status = "success";
	}

	override render() {
		return html`
      <speeedy-dialog .open=${this.open} @speeedy-dialog-close=${this.hide}>
        <div class="w-[min(28rem,calc(100vw-2rem))] bg-base-100 rounded-2xl shadow-2xl border border-base-200 animate-in zoom-in-95 fade-in duration-300">
          <div class="card-body p-6">

            <div class="flex justify-between items-center mb-4">
              <h3 class="font-semibold text-lg">Send Feedback</h3>
              <button class="btn btn-ghost btn-circle btn-sm" @click=${this.hide}>${icon(X, "w-4 h-4")}</button>
            </div>

            ${
							this.status === "success"
								? html`
                <div class="text-center py-8">
                  <div class="text-5xl mb-4">${icon(Rocket, "w-12 h-12 text-primary")}</div>
                  <p class="font-medium text-lg">Thank you!</p>
                  <p class="text-ui-muted mt-1">Finish your report in the GitHub tab that just opened.</p>
                  <button class="btn btn-ghost mt-6" @click=${this.hide}>Close</button>
                </div>
              `
								: html`
                <form @submit=${this.handleSubmit} class="flex flex-col gap-5">

                  <!-- Type selector -->
                  <div class="flex gap-2">
                    ${(["bug", "feature", "other"] as const).map(
											(t) => html`
                      <button
                        type="button"
                        class="btn flex-1 btn-sm ${this.feedbackType === t ? "btn-primary" : "btn-ghost border"}"
                        @click=${() => (this.feedbackType = t)}>
                        ${t === "bug" ? html`${icon(Bug, "w-4 h-4")} Bug` : t === "feature" ? html`${icon(Rocket, "w-4 h-4")} Feature` : html`${icon(MessageCircle, "w-4 h-4")} Other`}
                      </button>
                    `,
										)}
                  </div>

                  <speeedy-textarea
                    placeholder=${
											this.feedbackType === "bug"
												? "What happened? How can I reproduce it?"
												: this.feedbackType === "feature"
													? "What would you like to see added or improved?"
													: "Share your thoughts..."
										}
                    .value=${this.message}
                    min-height="140px"
                    @change=${(e: CustomEvent<{ value: string }>) => (this.message = e.detail.value)}
                  ></speeedy-textarea>

                  ${
										this.status === "error"
											? html`
                    <p class="text-error text-sm">Failed to send. Please try again.</p>
                  `
											: ""
									}

                  <button
                    type="submit"
                    class="btn btn-primary"
                    ?disabled=${!this.message.trim() || this.status === "sending"}>
                    ${
											this.status === "sending"
												? html`<span class="loading loading-spinner"></span> Sending...`
												: "Continue on GitHub"
										}
                  </button>

                </form>
              `
						}
          </div>
        </div>
      </speeedy-dialog>
    `;
	}
}
