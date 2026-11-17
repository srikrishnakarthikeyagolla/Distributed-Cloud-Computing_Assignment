import { useEffect, useRef, useState } from "react";

const emptyForm = {
  name: "",
  email: "",
  password: "",
  pincode: "",
  address: "",
  job: "",
  workplace: "",
  interests: "",
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(result.error || "Something went wrong. Please try again.");
    error.status = response.status;
    throw error;
  }

  return result;
}

function NeighborhoodDashboard({ user, onSignOut }) {
  const [people, setPeople] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let active = true;

    request("/api/neighborhood/people")
      .then(({ people: neighbors }) => {
        if (!active) return;
        setPeople(neighbors);
        setSelectedPerson((current) =>
          current ? neighbors.find((person) => person.id === current.id) ?? null : neighbors[0] ?? null,
        );
      })
      .catch((loadError) => {
        if (active) setChatError(loadError.message);
      })
      .finally(() => {
        if (active) setLoadingPeople(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedPerson) {
      setMessages([]);
      return undefined;
    }

    let active = true;
    let fetching = false;
    const loadMessages = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await request(
          `/api/neighborhood/messages/${encodeURIComponent(selectedPerson.id)}`,
        );
        if (active) {
          setMessages((current) => {
            const uniqueMessages = new Map(
              [...result.messages, ...current].map((message) => [message.id, message]),
            );
            return [...uniqueMessages.values()]
              .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
              .slice(-200);
          });
          setChatError("");
        }
      } catch (loadError) {
        if (active) setChatError(loadError.message);
      } finally {
        fetching = false;
        if (active) setLoadingMessages(false);
      }
    };

    setMessages([]);
    setLoadingMessages(true);
    loadMessages();
    const intervalId = window.setInterval(loadMessages, 4000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [selectedPerson]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedPerson || sending) return;

    setSending(true);
    setChatError("");
    try {
      const { message } = await request(
        `/api/neighborhood/messages/${encodeURIComponent(selectedPerson.id)}`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setMessages((current) =>
        current.some((existing) => existing.id === message.id) ? current : [...current, message],
      );
      setDraft("");
    } catch (sendError) {
      setChatError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  const filteredPeople = people.filter((person) =>
    `${person.name} ${person.job} ${person.workplace} ${(person.interests || []).join(" ")}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const selectedIsVisible = selectedPerson && filteredPeople.some((person) => person.id === selectedPerson.id);
  const lastMessage = selectedPerson && messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <main className="dashboard-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Commonground home">
          <span className="brand-mark">c.</span>
          <span>common<span className="brand-light">ground</span></span>
        </a>
        <div className="topbar-account">
          <span className="topbar-greeting">Hi, {user.name.split(" ")[0]}</span>
          <button className="button button-outline signout-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <section className="community-heading">
        <div>
          <p className="eyebrow">Your neighborhood</p>
          <h1>Good to have you here, {user.name.split(" ")[0]}.</h1>
          <p className="community-subtitle">
            Meet people in your area and start a conversation.
          </p>
        </div>
        <div className="area-badge">
          <span aria-hidden="true">⌖</span>
          <span>Area pincode <strong>{user.pincode}</strong></span>
        </div>
      </section>

      <section className="community-layout" aria-label="Neighborhood people and messages">
        <aside className="people-panel">
          <div className="people-panel-heading">
            <div>
              <h2>People nearby</h2>
              <p>{people.length} {people.length === 1 ? "neighbor" : "neighbors"} in your area</p>
            </div>
            <span className="people-count">{people.length}</span>
          </div>
          {people.length > 0 && (
            <label className="people-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="Search neighbors"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search neighbors"
              />
            </label>
          )}
          <div className="people-list">
            {loadingPeople ? (
              <p className="people-empty">Finding people in your area…</p>
            ) : people.length === 0 ? (
              <div className="people-empty">
                <span className="empty-illustration" aria-hidden="true">⌂</span>
                <strong>You’re the first one here.</strong>
                <span>When more people join with your pincode, they’ll show up here.</span>
              </div>
            ) : filteredPeople.length === 0 ? (
              <p className="people-empty">No neighbors match that search.</p>
            ) : (
              filteredPeople.map((person) => {
                const latest = lastMessage &&
                  (lastMessage.senderId === person.id || lastMessage.recipientId === person.id)
                  ? lastMessage
                  : null;
                return (
                  <button
                    className={`person-row${selectedPerson?.id === person.id ? " selected" : ""}`}
                    key={person.id}
                    disabled={sending}
                    onClick={() => {
                      setChatError("");
                      setSelectedPerson(person);
                    }}
                    type="button"
                    aria-pressed={selectedPerson?.id === person.id}
                  >
                    <span className="avatar person-avatar">{person.name.charAt(0).toUpperCase()}</span>
                    <span className="person-summary">
                      <span className="person-name">{person.name}</span>
                      <span className="person-detail">{person.job || person.workplace || "Community member"}</span>
                    </span>
                    {latest && <span className="person-message-dot" aria-label="Conversation has messages" />}
                  </button>
                );
              })
            )}
          </div>
          <div className="my-profile-mini">
            <span className="avatar mini-avatar">{user.name.charAt(0).toUpperCase()}</span>
            <span>
              <strong>{user.name}</strong>
              <span>Your neighborhood profile</span>
            </span>
          </div>
        </aside>

        <section className="conversation-panel" aria-label="Conversation">
          {!selectedPerson ? (
            <div className="conversation-empty">
              <span className="conversation-empty-icon" aria-hidden="true">↗</span>
              <h2>Your next good conversation starts here.</h2>
              <p>Neighbors who share your pincode will appear on the left. Choose someone to say hello.</p>
            </div>
          ) : !selectedIsVisible ? (
            <div className="conversation-empty">
              <span className="conversation-empty-icon" aria-hidden="true">⌕</span>
              <h2>No neighbors match your search.</h2>
              <p>Try a different name, job, or interest.</p>
            </div>
          ) : (
            <>
              <header className="conversation-header">
                <span className="avatar conversation-avatar">
                  {selectedPerson.name.charAt(0).toUpperCase()}
                </span>
                <span className="conversation-person">
                  <strong>{selectedPerson.name}</strong>
                  <span>{[selectedPerson.job, selectedPerson.workplace].filter(Boolean).join(" · ") || "Your neighbor"}</span>
                </span>
                <span className="area-member-badge">Same area</span>
              </header>
              <div className="conversation-profile">
                <p className="eyebrow">A neighbor in {user.pincode}</p>
                {selectedPerson.interests?.length > 0 && (
                  <div className="interest-list" aria-label={`${selectedPerson.name}'s interests`}>
                    {selectedPerson.interests.map((interest) => (
                      <span className="interest-chip" key={interest}>{interest}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="messages-area" aria-live="polite" aria-label="Messages">
                <div className="conversation-start">
                  <span className="conversation-start-mark">c.</span>
                  <strong>You and {selectedPerson.name} are neighbors.</strong>
                  <span>Say hello and get to know someone nearby.</span>
                </div>
                {loadingMessages && messages.length === 0 ? (
                  <p className="messages-loading">Opening your conversation…</p>
                ) : messages.map((message) => {
                  const ownMessage = message.senderId === user.id;
                  return (
                    <div className={`message-row${ownMessage ? " own-message" : ""}`} key={message.id}>
                      {!ownMessage && (
                        <span className="avatar message-avatar">{selectedPerson.name.charAt(0).toUpperCase()}</span>
                      )}
                      <div className="message-content">
                        <span className="message-sender">{ownMessage ? "You" : selectedPerson.name}</span>
                        <p>{message.content}</p>
                        <time dateTime={message.createdAt}>
                          {new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </time>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              <form className="message-composer" onSubmit={sendMessage}>
                {chatError && <p className="chat-error" role="alert">{chatError}</p>}
                <label className="sr-only" htmlFor="message-draft">Write a message</label>
                <textarea
                  id="message-draft"
                  rows="2"
                  maxLength="2000"
                  placeholder={`Message ${selectedPerson.name}…`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form.requestSubmit();
                    }
                  }}
                />
                <div className="composer-footer">
                  <span>Press Enter to send · Shift + Enter for a new line</span>
                  <button className="button button-primary send-button" type="submit" disabled={!draft.trim() || sending}>
                    {sending ? "Sending…" : "Send"} <span aria-hidden="true">↑</span>
                  </button>
                </div>
              </form>
            </>
          )}
          {chatError && !selectedPerson && <p className="chat-error dashboard-error" role="alert">{chatError}</p>}
        </section>
      </section>
    </main>
  );
}

function App() {
  const [mode, setMode] = useState("signup");
  const [form, setForm] = useState(emptyForm);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    request("/api/auth/me")
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((loadError) => {
        if (loadError.status !== 401) setError(loadError.message);
      })
      .finally(() => setLoading(false));
  }, []);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (name === "pincode") setLocationStatus("");
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setLocationStatus("");
  }

  function detectLocation() {
    setError("");
    setLocationStatus("");

    if (!navigator.geolocation) {
      setLocationStatus("Location is not supported by this browser. Enter your pincode instead.");
      return;
    }

    setLocationStatus("Waiting for your location permission…");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const result = await request(
            `/api/location/reverse?lat=${encodeURIComponent(coords.latitude)}&lon=${encodeURIComponent(coords.longitude)}`,
          );
          if (result.pincode) {
            setForm((current) => ({ ...current, pincode: result.pincode }));
            setLocationStatus(`Pincode found: ${result.pincode}. You can change it if needed.`);
          } else {
            setLocationStatus("We couldn't find a pincode for this location. Please enter it below.");
          }
        } catch (locationError) {
          setLocationStatus(locationError.message);
        }
      },
      (locationError) => {
        const messages = {
          1: "Location permission wasn't granted. You can enter your pincode below.",
          2: "Your location couldn't be determined. You can enter your pincode below.",
          3: "Location lookup timed out. You can enter your pincode below.",
        };
        setLocationStatus(messages[locationError.code] || "Location lookup failed. Enter your pincode below.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (mode === "signup") {
        const payload = {
          ...form,
          interests: form.interests
            .split(",")
            .map((interest) => interest.trim())
            .filter(Boolean),
        };
        const result = await request("/api/auth/signup", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setForm((current) => ({ ...current, password: "" }));
        setUser(result.user);
      } else {
        const result = await request("/api/auth/signin", {
          method: "POST",
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        setForm((current) => ({ ...current, password: "" }));
        setUser(result.user);
      }
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut() {
    try {
      await request("/api/auth/signout", { method: "POST" });
      setUser(null);
      setForm(emptyForm);
      setMode("signin");
    } catch (signOutError) {
      setError(signOutError.message);
    }
  }

  if (loading) {
    return <main className="loading-screen">Getting your neighborhood ready…</main>;
  }

  if (user) {
    return <NeighborhoodDashboard user={user} onSignOut={signOut} />;
  }

  const isSignup = mode === "signup";

  return (
    <main className="auth-page">
      <section className="story-panel">
        <a className="brand brand-on-dark" href="/" aria-label="Common ground home">
          <span className="brand-mark">c.</span>
          <span>common<span className="brand-light">ground</span></span>
        </a>
        <div className="story-content">
          <p className="eyebrow">A little closer to home</p>
          <h1>Your neighborhood is full of people you haven’t met yet.</h1>
          <p className="story-copy">
            Find familiar faces, share what you know, and make something good happen right where you live.
          </p>
          <div className="neighbor-note">
            <div className="neighbor-avatars" aria-hidden="true">
              <span>J</span><span>M</span><span>A</span>
            </div>
            <p><strong>Good things start nearby.</strong><br />Make your corner of the world feel a little smaller.</p>
          </div>
        </div>
        <p className="panel-footer">Built for the people around you.</p>
      </section>

      <section className="form-panel">
        <div className="form-wrap">
          <div className="mobile-brand">
            <a className="brand" href="/" aria-label="Common ground home">
              <span className="brand-mark">c.</span>
              <span>common<span className="brand-light">ground</span></span>
            </a>
          </div>
          <p className="eyebrow form-eyebrow">{isSignup ? "Join your neighborhood" : "Welcome back"}</p>
          <h2>{isSignup ? "Make yourself at home." : "Good to see you again."}</h2>
          <p className="form-intro">
            {isSignup
              ? "Create your profile and meet the people around you."
              : "Sign in to pick up where your neighborhood left off."}
          </p>

          <div className="mode-switch" role="tablist" aria-label="Account action">
            <button
              className={isSignup ? "mode-tab active" : "mode-tab"}
              onClick={() => changeMode("signup")}
              role="tab"
              aria-selected={isSignup}
              type="button"
            >
              Create account
            </button>
            <button
              className={!isSignup ? "mode-tab active" : "mode-tab"}
              onClick={() => changeMode("signin")}
              role="tab"
              aria-selected={!isSignup}
              type="button"
            >
              Sign in
            </button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isSignup && (
              <>
                <div className="field">
                  <label htmlFor="name">Your name <span className="required">*</span></label>
                  <input id="name" name="name" autoComplete="name" maxLength="80" placeholder="How should we call you?" value={form.name} onChange={updateField} required />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="job">What do you do?</label>
                    <input id="job" name="job" maxLength="100" placeholder="Designer, teacher, student…" value={form.job} onChange={updateField} />
                  </div>
                  <div className="field">
                    <label htmlFor="workplace">School, college or workplace</label>
                    <input id="workplace" name="workplace" autoComplete="organization" maxLength="120" placeholder="Where you work or study" value={form.workplace} onChange={updateField} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="address">Address <span className="optional">Optional</span></label>
                  <input id="address" name="address" autoComplete="street-address" maxLength="200" placeholder="Street or neighborhood (optional)" value={form.address} onChange={updateField} />
                </div>
                <div className="field">
                  <label htmlFor="interests">Interests <span className="optional">Optional</span></label>
                  <input id="interests" name="interests" maxLength="300" placeholder="Gardening, books, football…" value={form.interests} onChange={updateField} />
                  <span className="field-hint">Separate interests with commas.</span>
                </div>
                <div className="field">
                  <div className="label-line">
                    <label htmlFor="pincode">Your area pincode <span className="required">*</span></label>
                    <button className="location-button" type="button" onClick={detectLocation}>
                      <span aria-hidden="true">⌖</span> Use my location
                    </button>
                  </div>
                  <input id="pincode" name="pincode" autoComplete="postal-code" maxLength="12" placeholder="Enter your pincode" value={form.pincode} onChange={updateField} required />
                  <span className="field-hint">We use your pincode to find people in your area. Your precise location isn’t saved.</span>
                  {locationStatus && <span className="inline-status" role="status">{locationStatus}</span>}
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="email">Email address <span className="required">*</span></label>
              <input id="email" name="email" type="email" autoComplete="email" maxLength="254" placeholder="you@example.com" value={form.email} onChange={updateField} required />
            </div>
            <div className="field">
              <label htmlFor="password">Password <span className="required">*</span></label>
              <input id="password" name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 8 : undefined} maxLength="72" placeholder={isSignup ? "At least 8 characters" : "Your password"} value={form.password} onChange={updateField} required />
              {isSignup && <span className="field-hint">Use at least 8 characters.</span>}
            </div>

            {error && <p className="form-error" role="alert">{error}</p>}

            {isSignup && (
              <p className="privacy-note">
                Location access is optional. If you allow it, we use it once to find your pincode; your coordinates are not stored.
              </p>
            )}

            <button className="button button-primary submit-button" type="submit" disabled={submitting}>
              {submitting ? "One moment…" : isSignup ? "Create my account" : "Sign in"}
              {!submitting && <span aria-hidden="true">→</span>}
            </button>
          </form>

          <p className="switch-copy">
            {isSignup ? "Already part of the neighborhood?" : "New around here?"}{" "}
            <button type="button" onClick={() => changeMode(isSignup ? "signin" : "signup")}>
              {isSignup ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

export default App;
