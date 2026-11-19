import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

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

const emptyBusinessForm = {
  businessName: "",
  contactName: "",
  email: "",
  password: "",
  phone: "",
  category: "",
  pincode: "",
  address: "",
  description: "",
  services: "",
  openingHours: "",
  website: "",
  locationConsent: false,
  latitude: "",
  longitude: "",
};

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "include",
    headers: isFormData
      ? options.headers
      : { "Content-Type": "application/json", ...options.headers },
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

function ProfileAvatar({ profile, className = "", blurred = false }) {
  if (profile.profilePhotoUrl && !blurred) {
    return (
      <img
        className={`avatar avatar-image ${className}`}
        src={profile.profilePhotoUrl}
        alt={`${profile.name} profile`}
      />
    );
  }
  return (
    <span className={`avatar ${className}${blurred ? " identity-blurred" : ""}`} aria-hidden="true">
      {profile.name?.charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function BusinessInbox({ business }) {
  const [conversations, setConversations] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const socketRef = useRef(null);
  const selectedUserRef = useRef(selectedUser);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    let active = true;
    request("/api/business/conversations")
      .then(({ conversations: loaded }) => {
        if (!active) return;
        setConversations(loaded);
        setSelectedUser((current) => current || loaded[0]?.user || null);
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => {
        if (active) setLoading(false);
      });

    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    socket.on("business-chat:message", (message) => {
      if (message.businessId !== business.id) return;
      setConversations((current) => {
        const existing = current.find((item) => item.user.id === message.userId);
        const nextConversation = {
          user: existing?.user || (selectedUserRef.current?.id === message.userId ? selectedUserRef.current : null),
          lastMessage: message,
        };
        if (!nextConversation.user) return current;
        return [
          nextConversation,
          ...current.filter((item) => item.user.id !== message.userId),
        ];
      });
      request("/api/business/conversations")
        .then((result) => setConversations(result.conversations))
        .catch((loadError) => setError(loadError.message));
      if (selectedUserRef.current?.id === message.userId) {
        setMessages((current) =>
          current.some((item) => item.id === message.id) ? current : [...current, message],
        );
      }
    });
    socket.on("connect", () => {
      const activeUser = selectedUserRef.current;
      if (activeUser) socket.emit("business-chat:join", activeUser.id);
    });
    socket.on("connect_error", () => setError("Live inbox disconnected. Reconnecting…"));
    return () => {
      active = false;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [business.id]);

  useEffect(() => {
    if (!selectedUser) {
      setMessages([]);
      return undefined;
    }
    let active = true;
    setMessages([]);
    request(`/api/business/conversations/${encodeURIComponent(selectedUser.id)}`)
      .then(({ messages: loaded }) => {
        if (active) setMessages(loaded);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      });
    socketRef.current?.emit("business-chat:join", selectedUser.id, (result) => {
      if (result?.ok === false) setError(result.error);
    });
    return () => {
      active = false;
    };
  }, [selectedUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedUser || sending) return;
    setSending(true);
    setError("");
    try {
      const { message } = await request(
        `/api/business/conversations/${encodeURIComponent(selectedUser.id)}`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      setConversations((current) => {
        const existing = current.find((item) => item.user.id === selectedUser.id);
        return [
          { user: existing?.user || selectedUser, lastMessage: message },
          ...current.filter((item) => item.user.id !== selectedUser.id),
        ];
      });
      setDraft("");
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="community-layout business-inbox-layout" aria-label="Business customer inbox">
      <aside className="people-panel">
        <div className="people-panel-heading">
          <div><h2>Customer chats</h2><p>{conversations.length} conversations</p></div>
          <span className="people-count">{conversations.length}</span>
        </div>
        <div className="people-list">
          {loading ? <p className="people-empty">Loading your inbox…</p> : conversations.length === 0 ? (
            <p className="people-empty">When a neighbor messages your business, the conversation will appear here.</p>
          ) : conversations.map(({ user, lastMessage }) => (
            <button
              className={`person-row${selectedUser?.id === user.id ? " selected" : ""}`}
              key={user.id}
              type="button"
              onClick={() => setSelectedUser(user)}
            >
              <span className="avatar person-avatar">{user.name.charAt(0).toUpperCase()}</span>
              <span className="person-summary">
                <span className="person-name">{user.name}</span>
                <span className="person-detail">{lastMessage.content}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="conversation-panel" aria-label="Customer conversation">
        {!selectedUser ? (
          <div className="conversation-empty"><h2>Your business inbox</h2><p>Customer conversations will appear here.</p></div>
        ) : (
          <>
            <header className="conversation-header">
              <span className="avatar conversation-avatar">{selectedUser.name.charAt(0).toUpperCase()}</span>
              <span className="conversation-person"><strong>{selectedUser.name}</strong><span>Neighborhood customer</span></span>
            </header>
            <div className="messages-area" aria-live="polite">
              {messages.map((message) => {
                const ownMessage = message.senderType === "business";
                return (
                  <div className={`message-row${ownMessage ? " own-message" : ""}`} key={message.id}>
                    <div className="message-content">
                      <span className="message-sender">{ownMessage ? business.businessName : selectedUser.name}</span>
                      <p>{message.content}</p>
                      <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <form className="message-composer" onSubmit={sendMessage}>
              {error && <p className="chat-error" role="alert">{error}</p>}
              <label className="sr-only" htmlFor="business-message-draft">Write a reply</label>
              <textarea
                id="business-message-draft"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={2000}
                placeholder="Reply to your customer…"
                rows="2"
                disabled={sending}
              />
              <button className="button button-primary" type="submit" disabled={!draft.trim() || sending}>
                {sending ? "Sending…" : "Send reply"} <span aria-hidden="true">↗</span>
              </button>
            </form>
          </>
        )}
      </section>
    </section>
  );
}

function BusinessDashboard({ business, onSignOut, onBusinessUpdated, notice }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [activeView, setActiveView] = useState("profile");
  const photoInputRef = useRef(null);

  async function uploadPhotos(event) {
    event.preventDefault();
    const files = [...(photoInputRef.current?.files || [])];
    if (files.length === 0) {
      setError("Choose at least one photo.");
      return;
    }
    if (files.some((file) => file.size > 4 * 1024 * 1024)) {
      setError("Each photo must be 4 MB or smaller.");
      return;
    }
    if ((business.photos?.length || 0) + files.length > 5) {
      setError(`You can add ${Math.max(0, 5 - (business.photos?.length || 0))} more photo(s).`);
      return;
    }

    setUploading(true);
    setError("");
    setStatus("");
    try {
      const upload = new FormData();
      files.forEach((file) => upload.append("photos", file));
      const result = await request("/api/business/photos", { method: "POST", body: upload });
      onBusinessUpdated(result.business);
      setStatus("Business photos uploaded.");
      photoInputRef.current.value = "";
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(fileName) {
    setError("");
    setStatus("");
    try {
      const result = await request(`/api/business/photos/${encodeURIComponent(fileName)}`, {
        method: "DELETE",
      });
      onBusinessUpdated(result.business);
      setStatus("Business photo removed.");
    } catch (removeError) {
      setError(removeError.message);
    }
  }

  async function updateVisibility(isVisible) {
    setError("");
    setStatus("");
    try {
      const result = await request("/api/business/visibility", {
        method: "PUT",
        body: JSON.stringify({ isVisible }),
      });
      onBusinessUpdated(result.business);
      setStatus(isVisible ? "Your business profile is now visible to nearby users." : "Your business profile is hidden from the directory.");
    } catch (visibilityError) {
      setError(visibilityError.message);
    }
  }

  const location = business.location;

  return (
    <main className="business-dashboard">
      <header className="business-topbar">
        <a className="brand" href="/" aria-label="Commonground home">
          <span className="brand-mark">c.</span>
          <span>common<span className="brand-light">ground</span></span>
        </a>
        <nav className="topbar-nav" aria-label="Business navigation">
          <button className={`nav-button${activeView === "profile" ? " active" : ""}`} type="button" onClick={() => setActiveView("profile")}>Profile</button>
          <button className={`nav-button${activeView === "inbox" ? " active" : ""}`} type="button" onClick={() => setActiveView("inbox")}>Business chats</button>
        </nav>
        <div className="business-topbar-actions">
          <span>Business account</span>
          <button className="button button-outline" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      <section className="business-dashboard-heading">
        <p className="eyebrow">{activeView === "inbox" ? "Customer support" : "Business profile"}</p>
        <h1>{business.businessName}</h1>
        <p>{business.category} · {business.pincode}</p>
      </section>
      {activeView === "inbox" ? <BusinessInbox business={business} /> : (
      <div className="business-dashboard-grid">
        <section className="business-profile-card">
          <div className="business-profile-card-heading">
            <div className="business-mark-large" aria-hidden="true">{business.businessName.charAt(0).toUpperCase()}</div>
            <div>
              <span className="business-category-chip">{business.category}</span>
              <h2>{business.businessName}</h2>
              <p>Managed by {business.contactName}</p>
            </div>
          </div>
          <div className="business-visibility-control">
            <div>
              <strong>Visible to nearby users</strong>
              <span>{business.isVisible === false ? "Your profile is hidden and cannot receive new chats." : "People in your area can discover your profile and start a chat."}</span>
            </div>
            <input
              type="checkbox"
              checked={business.isVisible !== false}
              onChange={(event) => updateVisibility(event.target.checked)}
              aria-label="Make business profile visible to nearby users"
            />
          </div>
          {business.description && <p className="business-description">{business.description}</p>}
          <dl className="business-details">
            <div><dt>Contact</dt><dd>{business.phone}</dd></div>
            <div><dt>Email</dt><dd>{business.email}</dd></div>
            <div><dt>Address</dt><dd>{business.address}, {business.pincode}</dd></div>
            {business.openingHours && <div><dt>Opening hours</dt><dd>{business.openingHours}</dd></div>}
            {business.website && <div><dt>Website</dt><dd><a href={business.website} target="_blank" rel="noreferrer">{business.website}</a></dd></div>}
            {location && <div><dt>Saved map location</dt><dd>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</dd></div>}
          </dl>
          {business.services?.length > 0 && (
            <div className="business-services">
              <h3>Products & services</h3>
              <div className="interest-list">
                {business.services.map((service) => <span className="interest-chip" key={service}>{service}</span>)}
              </div>
            </div>
          )}
        </section>

        <section className="business-gallery-card">
          <div className="business-gallery-heading">
            <div>
              <p className="eyebrow">Showcase</p>
              <h2>Business photos</h2>
              <p>Add up to 5 photos of your shop, products, or work.</p>
            </div>
            <span className="people-count">{business.photos?.length || 0}/5</span>
          </div>
          {business.photos?.length ? (
            <div className="business-photo-grid">
              {business.photos.map((fileName) => (
                <figure className="business-photo-item" key={fileName}>
                  <img src={`/api/business/photos/${encodeURIComponent(fileName)}`} alt={`${business.businessName} showcase`} />
                  <button type="button" aria-label="Remove photo" onClick={() => removePhoto(fileName)}>×</button>
                </figure>
              ))}
            </div>
          ) : (
            <div className="business-gallery-empty">
              <span aria-hidden="true">▧</span>
              <p>Your business photos will appear here.</p>
            </div>
          )}
          {(business.photos?.length || 0) < 5 && (
            <form className="business-photo-form" onSubmit={uploadPhotos}>
              <label htmlFor="business-photos">Choose photos</label>
              <input
                id="business-photos"
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                required
              />
              <span>JPG, PNG, or WebP · 4 MB maximum per photo</span>
              <button className="button button-primary" type="submit" disabled={uploading}>
                {uploading ? "Uploading…" : "Upload photos"}
              </button>
            </form>
          )}
          {status && <p className="profile-feedback success" role="status">{status}</p>}
          {notice && <p className="form-error" role="alert">{notice}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      </div>
      )}
    </main>
  );
}

function NeighborhoodDashboard({ user, onSignOut, onUserUpdated }) {
  const [people, setPeople] = useState([]);
  const [connectionPeople, setConnectionPeople] = useState([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [pendingConnectionCount, setPendingConnectionCount] = useState(0);
  const [activeView, setActiveView] = useState("messages");
  const [connectionSearch, setConnectionSearch] = useState("");
  const [visibility, setVisibility] = useState(user.visibility || "connections");
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [profileError, setProfileError] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [businesses, setBusinesses] = useState([]);
  const [businessSearch, setBusinessSearch] = useState("");
  const [loadingBusinesses, setLoadingBusinesses] = useState(false);
  const [businessConversations, setBusinessConversations] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [businessMessages, setBusinessMessages] = useState([]);
  const [businessDraft, setBusinessDraft] = useState("");
  const [businessChatError, setBusinessChatError] = useState("");
  const [businessSending, setBusinessSending] = useState(false);
  const [loadingBusinessMessages, setLoadingBusinessMessages] = useState(false);
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const selectedPersonRef = useRef(selectedPerson);
  const selectedBusinessRef = useRef(selectedBusiness);
  const activeViewRef = useRef(activeView);
  const connectionSearchRef = useRef(connectionSearch);
  const searchRef = useRef(search);

  useEffect(() => {
    selectedPersonRef.current = selectedPerson;
  }, [selectedPerson]);

  useEffect(() => {
    selectedBusinessRef.current = selectedBusiness;
  }, [selectedBusiness]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    connectionSearchRef.current = connectionSearch;
  }, [connectionSearch]);

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    const socket = io({
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("chat:message", (message) => {
      const activePerson = selectedPersonRef.current;
      if (
        !activePerson ||
        (message.senderId !== activePerson.id && message.recipientId !== activePerson.id)
      ) {
        return;
      }
      setMessages((current) =>
        current.some((existing) => existing.id === message.id)
          ? current
          : [...current, message],
      );
    });

    socket.on("business-chat:message", (message) => {
      if (message.userId !== user.id) return;
      if (
        activeViewRef.current === "businessChats" &&
        selectedBusinessRef.current?.id === message.businessId
      ) {
        setBusinessMessages((current) =>
          current.some((existing) => existing.id === message.id)
            ? current
            : [...current, message],
        );
      }
      request("/api/neighborhood/business-chats")
        .then((result) => setBusinessConversations(result.conversations))
        .catch((loadError) => setBusinessChatError(loadError.message));
    });

    const refreshConnections = () => {
      request(`/api/neighborhood/connections?search=${encodeURIComponent(connectionSearchRef.current)}`)
        .then((result) => {
          setConnectionPeople(result.people);
          setPendingConnectionCount(result.pendingCount);
        })
        .catch((loadError) => setChatError(loadError.message));
    };

    socket.on("profile:update", () => {
      loadPeople(searchRef.current).catch((loadError) => setChatError(loadError.message));
    });
    socket.on("profile:update", refreshConnections);
    socket.on("connection:update", () => {
      refreshConnections();
      loadPeople(searchRef.current).catch((loadError) => setChatError(loadError.message));
    });

    socket.on("connect_error", () => {
      setChatError("Live chat disconnected. Reconnecting…");
    });

    socket.on("connect", () => {
      setChatError("");
      const activePerson = selectedPersonRef.current;
      if (activePerson) {
        socket.emit("chat:join", activePerson.id);
      }
      const activeBusiness = selectedBusinessRef.current;
      if (activeBusiness) socket.emit("business-chat:join", activeBusiness.id);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeView !== "businesses") return undefined;
    let active = true;
    setLoadingBusinesses(true);
    const timerId = window.setTimeout(async () => {
      try {
        const result = await request(
          `/api/neighborhood/businesses?search=${encodeURIComponent(businessSearch)}`,
        );
        if (active) setBusinesses(result.businesses);
      } catch (loadError) {
        if (active) setBusinessChatError(loadError.message);
      } finally {
        if (active) setLoadingBusinesses(false);
      }
    }, businessSearch ? 220 : 0);
    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [activeView, businessSearch]);

  useEffect(() => {
    if (activeView !== "businessChats") return undefined;
    let active = true;
    request("/api/neighborhood/business-chats")
      .then(({ conversations }) => {
        if (!active) return;
        setBusinessConversations(conversations);
        setSelectedBusiness((current) =>
          current || conversations[0]?.business || null,
        );
      })
      .catch((loadError) => {
        if (active) setBusinessChatError(loadError.message);
      });
    return () => {
      active = false;
    };
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "businessChats" || !selectedBusiness) {
      setBusinessMessages([]);
      return undefined;
    }
    let active = true;
    setLoadingBusinessMessages(true);
    setBusinessChatError("");
    setBusinessMessages([]);
    request(`/api/neighborhood/businesses/${encodeURIComponent(selectedBusiness.id)}/messages`)
      .then(({ messages: loaded }) => {
        if (active) setBusinessMessages(loaded);
      })
      .catch((loadError) => {
        if (active) setBusinessChatError(loadError.message);
      })
      .finally(() => {
        if (active) setLoadingBusinessMessages(false);
      });
    socketRef.current?.emit("business-chat:join", selectedBusiness.id, (result) => {
      if (result?.ok === false) setBusinessChatError(result.error);
    });
    return () => {
      active = false;
    };
  }, [activeView, selectedBusiness]);

  useEffect(() => {
    let active = true;
    setLoadingPeople(true);
    const timerId = window.setTimeout(async () => {
      try {
        await loadPeople(search, () => active);
        if (!active) return;
        setChatError("");
      } catch (loadError) {
        if (active) setChatError(loadError.message);
      } finally {
        if (active) setLoadingPeople(false);
      }
    }, search ? 220 : 0);

    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [search]);

  async function loadPeople(query = search, shouldApply = () => true) {
    const result = await request(
      `/api/neighborhood/people?search=${encodeURIComponent(query)}`,
    );
    if (shouldApply()) {
      setPeople(result.people);
      setSelectedPerson((current) => {
        if (!current) return result.people[0] ?? null;
        return result.people.find((person) => person.id === current.id) ?? null;
      });
    }
    return result;
  }

  async function loadConnections(query = connectionSearch) {
    setLoadingConnections(true);
    try {
      const result = await request(
        `/api/neighborhood/connections?search=${encodeURIComponent(query)}`,
      );
      setConnectionPeople(result.people);
      setPendingConnectionCount(result.pendingCount);
    } catch (loadError) {
      setChatError(loadError.message);
    } finally {
      setLoadingConnections(false);
    }
  }

  useEffect(() => {
    const timerId = window.setTimeout(() => loadConnections(connectionSearch), connectionSearch ? 220 : 0);
    return () => window.clearTimeout(timerId);
  }, [connectionSearch]);

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
    socketRef.current?.emit("chat:join", selectedPerson.id, (result) => {
      if (result?.ok === false) setChatError(result.error);
    });
    return () => {
      active = false;
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
      const socket = socketRef.current;
      if (!socket?.connected) {
        const { message } = await request(
          `/api/neighborhood/messages/${encodeURIComponent(selectedPerson.id)}`,
          { method: "POST", body: JSON.stringify({ content }) },
        );
        setMessages((current) =>
          current.some((existing) => existing.id === message.id) ? current : [...current, message],
        );
        setDraft("");
      } else {
        await new Promise((resolve, reject) => {
          socket.emit(
            "chat:send",
            { recipientId: selectedPerson.id, content },
            (result) => {
              if (!result?.ok) {
                reject(new Error(result?.error || "Could not send the message."));
                return;
              }
              setMessages((current) =>
                current.some((existing) => existing.id === result.message.id)
                  ? current
                  : [...current, result.message],
              );
              resolve();
            },
          );
        });
        setDraft("");
      }
    } catch (sendError) {
      setChatError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  function openBusinessChat(business) {
    setSelectedBusiness(business);
    setBusinessChatError("");
    setActiveView("businessChats");
  }

  async function sendBusinessMessage(event) {
    event.preventDefault();
    const content = businessDraft.trim();
    if (!content || !selectedBusiness || businessSending) return;
    setBusinessSending(true);
    setBusinessChatError("");
    try {
      const { message } = await request(
        `/api/neighborhood/businesses/${encodeURIComponent(selectedBusiness.id)}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setBusinessMessages((current) =>
        current.some((existing) => existing.id === message.id) ? current : [...current, message],
      );
      setBusinessConversations((current) => [
        {
          business: selectedBusiness,
          lastMessage: message,
        },
        ...current.filter((item) => item.business.id !== selectedBusiness.id),
      ]);
      setBusinessDraft("");
    } catch (sendError) {
      setBusinessChatError(sendError.message);
    } finally {
      setBusinessSending(false);
    }
  }

  const filteredPeople = people;
  const filteredConnectionPeople = connectionPeople;
  const selectedIsVisible = selectedPerson && filteredPeople.some((person) => person.id === selectedPerson.id);
  const lastMessage = selectedPerson && messages.length > 0 ? messages[messages.length - 1] : null;

  async function updateConnection(person, action) {
    try {
      const result = await request(
        action === "accept"
          ? `/api/neighborhood/connections/${person.id}/accept`
          : `/api/neighborhood/connections/${person.id}`,
        { method: "POST" },
      );
      setConnectionPeople((current) =>
        current.map((item) =>
          item.id === person.id
            ? { ...item, connectionStatus: result.connectionStatus }
            : item,
        ),
      );
      await Promise.all([loadConnections(), loadPeople()]);
    } catch (connectionError) {
      setChatError(connectionError.message);
    }
  }

  async function updateVisibility(nextVisibility) {
    setSavingVisibility(true);
    setProfileError("");
    setProfileStatus("");
    try {
      const result = await request("/api/auth/visibility", {
        method: "PUT",
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      setVisibility(result.visibility);
      setPeople([]);
      setConnectionPeople([]);
      const [peopleResult, connectionsResult] = await Promise.all([
        request(`/api/neighborhood/people?search=${encodeURIComponent(search)}`),
        request(`/api/neighborhood/connections?search=${encodeURIComponent(connectionSearch)}`),
      ]);
      setPeople(peopleResult.people);
      setConnectionPeople(connectionsResult.people);
      setPendingConnectionCount(connectionsResult.pendingCount);
      setSelectedPerson((current) =>
        current
          ? peopleResult.people.find((person) => person.id === current.id) ?? current
          : peopleResult.people[0] ?? null,
      );
      setProfileStatus("Your privacy settings have been updated.");
    } catch (visibilityError) {
      setProfileError(visibilityError.message);
    } finally {
      setSavingVisibility(false);
    }
  }

  async function saveProfilePhoto(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.photo.files[0];
    if (!file) {
      setProfileError("Choose a photo to upload.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileError("Profile photos must be 2 MB or smaller.");
      return;
    }

    setPhotoUploading(true);
    setProfileError("");
    setProfileStatus("");
    try {
      const upload = new FormData();
      upload.append("photo", file);
      const result = await request("/api/auth/profile-photo", {
        method: "POST",
        body: upload,
      });
      onUserUpdated(result.user);
      setProfileStatus("Your profile photo has been updated.");
      form.reset();
    } catch (photoError) {
      setProfileError(photoError.message);
    } finally {
      setPhotoUploading(false);
    }
  }

  async function removeProfilePhoto() {
    setPhotoUploading(true);
    setProfileError("");
    setProfileStatus("");
    try {
      const result = await request("/api/auth/profile-photo", { method: "DELETE" });
      onUserUpdated(result.user);
      setProfileStatus("Your profile photo has been removed.");
    } catch (photoError) {
      setProfileError(photoError.message);
    } finally {
      setPhotoUploading(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setProfileError("");
    setProfileStatus("");
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setProfileError("The new passwords don’t match.");
      return;
    }
    setSavingPassword(true);
    try {
      const result = await request("/api/auth/password", {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setProfileStatus(result.message);
    } catch (passwordError) {
      setProfileError(passwordError.message);
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <main className="dashboard-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Commonground home">
          <span className="brand-mark">c.</span>
          <span>common<span className="brand-light">ground</span></span>
        </a>
        <nav className="topbar-nav" aria-label="Primary navigation">
          <button
            className={`nav-button${activeView === "messages" ? " active" : ""}`}
            type="button"
            onClick={() => setActiveView("messages")}
          >
            Messages
          </button>
          <button
            className={`nav-button${activeView === "connections" ? " active" : ""}`}
            type="button"
            onClick={() => setActiveView("connections")}
          >
            Connect
            {pendingConnectionCount > 0 && (
              <span className="nav-count" aria-label={`${pendingConnectionCount} pending requests`}>
                {pendingConnectionCount}
              </span>
            )}
          </button>
          <button
            className={`nav-button${activeView === "businesses" ? " active" : ""}`}
            type="button"
            onClick={() => setActiveView("businesses")}
          >
            Businesses
          </button>
          <button
            className={`nav-button${activeView === "businessChats" ? " active" : ""}`}
            type="button"
            onClick={() => setActiveView("businessChats")}
          >
            Business chats
            {businessConversations.length > 0 && (
              <span className="nav-count" aria-label={`${businessConversations.length} business conversations`}>
                {businessConversations.length}
              </span>
            )}
          </button>
          <button
            className={`nav-button${activeView === "profile" ? " active" : ""}`}
            type="button"
            onClick={() => setActiveView("profile")}
          >
            Profile
          </button>
        </nav>
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

      {activeView === "profile" ? (
        <section className="profile-settings-page" aria-labelledby="profile-settings-heading">
          <header className="profile-settings-heading">
            <p className="eyebrow">Your account</p>
            <h2 id="profile-settings-heading">Profile & settings</h2>
            <p>Manage your profile photo, password, and who can see your information.</p>
          </header>
          <div className="profile-settings-grid">
            <section className="profile-settings-card photo-settings-card" aria-labelledby="photo-heading">
              <div>
                <p className="eyebrow">Your profile</p>
                <h3 id="photo-heading">Profile photo</h3>
                <p className="profile-settings-copy">Use a clear photo so your neighbors can recognize you.</p>
              </div>
              <div className="profile-photo-preview">
                <ProfileAvatar profile={user} className="profile-photo-large" />
                <div>
                  <strong>{user.name}</strong>
                  <span>JPG, PNG, or WebP · up to 2 MB</span>
                </div>
              </div>
              <form className="photo-upload-form" onSubmit={saveProfilePhoto}>
                <label className="profile-file-label" htmlFor="profile-photo-file">Choose a photo</label>
                <input
                  id="profile-photo-file"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                />
                <button className="button button-primary profile-action-button" type="submit" disabled={photoUploading}>
                  {photoUploading ? "Uploading…" : "Upload photo"}
                </button>
                {user.profilePhotoUrl && (
                  <button
                    className="button button-outline profile-action-button"
                    type="button"
                    onClick={removeProfilePhoto}
                    disabled={photoUploading}
                  >
                    Remove photo
                  </button>
                )}
              </form>
            </section>

            <section className="profile-settings-card password-settings-card" aria-labelledby="password-heading">
              <div>
                <p className="eyebrow">Account security</p>
                <h3 id="password-heading">Change password</h3>
                <p className="profile-settings-copy">Choose a new password you don’t use elsewhere.</p>
              </div>
              <form className="password-form" onSubmit={changePassword}>
                <label>
                  Current password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength="8"
                    maxLength="72"
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength="8"
                    maxLength="72"
                    value={passwordForm.confirmPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    required
                  />
                </label>
                <button className="button button-primary profile-action-button" type="submit" disabled={savingPassword}>
                  {savingPassword ? "Saving…" : "Update password"}
                </button>
              </form>
            </section>
          </div>

          <section className="profile-settings-card profile-privacy-card" aria-labelledby="privacy-heading">
            <div>
              <p className="eyebrow">Profile privacy</p>
              <h3 id="privacy-heading">Choose who can see your profile</h3>
              <p className="profile-settings-copy">
                Your interests, designation, and workplace stay searchable so neighbors can find common ground.
              </p>
            </div>
            <div className="privacy-options" role="radiogroup" aria-label="Profile visibility">
            {[
              {
                value: "public",
                title: "Public",
                description: "People in your area can see your photo, name, address, interests, and work details.",
              },
              {
                value: "private",
                title: "Private",
                description: "Your name, address, and photo are hidden. People can still find you by interests, designation, or workplace.",
              },
              {
                value: "connections",
                title: "Connections only",
                description: "Your name, address, and photo are hidden until you accept a connection request. Connected neighbors can see your full profile.",
              },
            ].map((option) => (
              <label
                className={`privacy-option${visibility === option.value ? " selected" : ""}`}
                key={option.value}
              >
                <input
                  type="radio"
                  name="profile-visibility"
                  value={option.value}
                  checked={visibility === option.value}
                  disabled={savingVisibility}
                  onChange={() => updateVisibility(option.value)}
                />
                <span className="privacy-option-copy">
                  <strong>{option.title}</strong>
                  <span>{option.description}</span>
                </span>
                <span className="privacy-option-check" aria-hidden="true">
                  {visibility === option.value ? "✓" : ""}
                </span>
              </label>
            ))}
          </div>
          <p className="privacy-note">
            You can still chat and send or accept connection requests when your profile is private.
          </p>
          </section>
          {(savingVisibility || photoUploading || savingPassword) && (
            <p className="privacy-status" role="status">Saving your profile settings…</p>
          )}
          {profileStatus && <p className="profile-feedback success" role="status">{profileStatus}</p>}
          {profileError && <p className="chat-error" role="alert">{profileError}</p>}
        </section>
      ) : activeView === "connections" ? (
        <section className="connections-page" aria-label="Find and connect with people nearby">
          <header className="connections-heading">
            <div>
              <p className="eyebrow">Community connections</p>
              <h2>Meet someone nearby</h2>
              <p>Search by name or interest, then send a connection request.</p>
            </div>
            <label className="connections-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="Search by name or interest"
                value={connectionSearch}
                onChange={(event) => setConnectionSearch(event.target.value)}
                aria-label="Search people to connect with"
              />
            </label>
          </header>
          {loadingConnections ? (
            <div className="connections-empty">
              <span aria-hidden="true">⌕</span>
              <h3>Finding people nearby…</h3>
            </div>
          ) : filteredConnectionPeople.length === 0 ? (
            <div className="connections-empty">
              <span aria-hidden="true">⌕</span>
              <h3>No people match your search.</h3>
              <p>Try another name or interest.</p>
            </div>
          ) : activeView === "businesses" ? (
            <section className="business-directory-page" aria-label="Businesses nearby">
              <header className="connections-heading">
                <div>
                  <p className="eyebrow">Local businesses</p>
                  <h2>Discover businesses nearby</h2>
                  <p>Browse businesses in your area and start a separate business chat.</p>
                </div>
                <label className="connections-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    placeholder="Search business, category, or service"
                    value={businessSearch}
                    onChange={(event) => setBusinessSearch(event.target.value)}
                    aria-label="Search businesses by name, category, or service"
                  />
                </label>
              </header>
              {businessChatError && <p className="chat-error" role="alert">{businessChatError}</p>}
              {loadingBusinesses ? (
                <div className="connections-empty"><h3>Finding businesses nearby…</h3></div>
              ) : businesses.length === 0 ? (
                <div className="connections-empty">
                  <h3>No businesses found in your area.</h3>
                  <p>Try a different search, or check back when more businesses join.</p>
                </div>
              ) : (
                <div className="business-directory-grid">
                  {businesses.map((business) => (
                    <article className="business-directory-card" key={business.id}>
                      {business.photos?.length > 0 ? (
                        <img
                          className="business-directory-photo"
                          src={business.photos[0]}
                          alt={`${business.businessName} preview`}
                        />
                      ) : (
                        <div className="business-directory-placeholder" aria-hidden="true">
                          {business.businessName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="business-directory-copy">
                        <span className="business-category-chip">{business.category}</span>
                        <h3>{business.businessName}</h3>
                        <p>{business.description || business.address}</p>
                        {business.services?.length > 0 && (
                          <div className="interest-list">
                            {business.services.slice(0, 4).map((service) => (
                              <span className="interest-chip" key={service}>{service}</span>
                            ))}
                          </div>
                        )}
                        <button
                          className="button button-primary connection-button"
                          type="button"
                          onClick={() => openBusinessChat(business)}
                        >
                          Message business
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : activeView === "businessChats" ? (
            <section className="community-layout business-chats-layout" aria-label="Business chats">
              <aside className="people-panel">
                <div className="people-panel-heading">
                  <div><h2>Business chats</h2><p>{businessConversations.length} conversations</p></div>
                  <span className="people-count">{businessConversations.length}</span>
                </div>
                <div className="people-list">
                  {businessConversations.length === 0 ? (
                    <div className="people-empty">
                      <strong>No business chats yet.</strong>
                      <span>Discover a business nearby to start a conversation.</span>
                      <button className="button button-outline" type="button" onClick={() => setActiveView("businesses")}>Browse businesses</button>
                    </div>
                  ) : businessConversations.map(({ business, lastMessage }) => (
                    <button
                      className={`person-row${selectedBusiness?.id === business.id ? " selected" : ""}`}
                      key={business.id}
                      type="button"
                      onClick={() => {
                        setSelectedBusiness(business);
                        setBusinessChatError("");
                      }}
                    >
                      <span className="avatar person-avatar">{business.businessName.charAt(0).toUpperCase()}</span>
                      <span className="person-summary">
                        <span className="person-name">{business.businessName}</span>
                        <span className="person-detail">{lastMessage.content}</span>
                      </span>
                    </button>
                  ))}
                  {selectedBusiness && !businessConversations.some((item) => item.business.id === selectedBusiness.id) && (
                    <button className="person-row selected" type="button">
                      <span className="avatar person-avatar">{selectedBusiness.businessName.charAt(0).toUpperCase()}</span>
                      <span className="person-summary"><span className="person-name">{selectedBusiness.businessName}</span><span className="person-detail">New conversation</span></span>
                    </button>
                  )}
                </div>
              </aside>
              <section className="conversation-panel" aria-label="Business conversation">
                {!selectedBusiness ? (
                  <div className="conversation-empty">
                    <h2>Your business chats stay separate.</h2>
                    <p>Choose a business from the list, or discover a nearby business to say hello.</p>
                  </div>
                ) : (
                  <>
                    <header className="conversation-header">
                      <span className="avatar conversation-avatar">{selectedBusiness.businessName.charAt(0).toUpperCase()}</span>
                      <span className="conversation-person">
                        <strong>{selectedBusiness.businessName}</strong>
                        <span>{selectedBusiness.category} · {selectedBusiness.pincode}</span>
                        {selectedBusiness.address && <span>{selectedBusiness.address}</span>}
                      </span>
                      <span className="area-member-badge">Local business</span>
                    </header>
                    <div className="conversation-profile">
                      {selectedBusiness.description && <p>{selectedBusiness.description}</p>}
                      {selectedBusiness.photos?.length > 0 && (
                        <div className="business-chat-photos">
                          {selectedBusiness.photos.map((photo) => <img key={photo} src={photo} alt={`${selectedBusiness.businessName} showcase`} />)}
                        </div>
                      )}
                    </div>
                    <div className="messages-area" aria-live="polite" aria-label="Business messages">
                      {loadingBusinessMessages && businessMessages.length === 0 ? (
                        <p className="messages-loading">Opening your business chat…</p>
                      ) : businessMessages.map((message) => {
                        const ownMessage = message.senderType === "user";
                        return (
                          <div className={`message-row${ownMessage ? " own-message" : ""}`} key={message.id}>
                            <div className="message-content">
                              <span className="message-sender">{ownMessage ? "You" : selectedBusiness.businessName}</span>
                              <p>{message.content}</p>
                              <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                            </div>
                          </div>
                        );
                      })}
                      {!loadingBusinessMessages && businessMessages.length === 0 && (
                        <div className="conversation-start"><span className="conversation-start-mark">c.</span><strong>Start a business conversation.</strong><span>Ask about products, services, or opening hours.</span></div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                    <form className="message-composer" onSubmit={sendBusinessMessage}>
                      {businessChatError && <p className="chat-error" role="alert">{businessChatError}</p>}
                      <label className="sr-only" htmlFor="business-chat-draft">Write a business message</label>
                      <textarea
                        id="business-chat-draft"
                        value={businessDraft}
                        onChange={(event) => setBusinessDraft(event.target.value)}
                        maxLength={2000}
                        placeholder={`Message ${selectedBusiness.businessName}…`}
                        rows="2"
                        disabled={businessSending}
                      />
                      <button className="button button-primary" type="submit" disabled={!businessDraft.trim() || businessSending}>
                        {businessSending ? "Sending…" : "Send message"} <span aria-hidden="true">↗</span>
                      </button>
                    </form>
                  </>
                )}
              </section>
            </section>
          ) : (
            <div className="connection-grid">
              {filteredConnectionPeople.map((person) => (
                <article className="connection-card" key={person.id}>
                  <div className="connection-card-person">
                    <ProfileAvatar
                      profile={person}
                      className="connection-card-avatar"
                      blurred={!person.nameVisible}
                    />
                    <div>
                      <h3 className={person.nameVisible ? "" : "identity-blurred"} aria-label={person.nameVisible ? undefined : "Private profile"}>
                        {person.name}
                      </h3>
                      <p>{[person.job, person.workplace].filter(Boolean).join(" · ") || "Community member"}</p>
                    </div>
                  </div>
                  {person.address && <p className="connection-address">{person.address}</p>}
                  {person.interests?.length > 0 && (
                    <div className="interest-list">
                      {person.interests.slice(0, 5).map((interest) => (
                        <span className="interest-chip" key={interest}>{interest}</span>
                      ))}
                    </div>
                  )}
                  {person.connectionStatus === "connected" ? (
                    <button className="button connection-button connected" type="button" disabled>
                      Connected ✓
                    </button>
                  ) : person.connectionStatus === "incoming" ? (
                    <button
                      className="button button-primary connection-button"
                      type="button"
                      onClick={() => updateConnection(person, "accept")}
                    >
                      Accept request
                    </button>
                  ) : person.connectionStatus === "sent" ? (
                    <button className="button connection-button pending" type="button" disabled>
                      Request sent
                    </button>
                  ) : (
                    <button
                      className="button button-primary connection-button"
                      type="button"
                      onClick={() => updateConnection(person, "request")}
                    >
                      Connect
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
      <section className="community-layout" aria-label="Neighborhood people and messages">
        <aside className="people-panel">
          <div className="people-panel-heading">
            <div>
              <h2>People nearby</h2>
              <p>{people.length} {people.length === 1 ? "neighbor" : "neighbors"} in your area</p>
            </div>
            <span className="people-count">{people.length}</span>
          </div>
          <label className="people-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Search name, interest, or work"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search neighbors by name, interest, or work"
            />
          </label>
          <div className="people-list">
            {loadingPeople ? (
              <p className="people-empty">Finding people in your area…</p>
            ) : search.trim() && people.length === 0 ? (
              <p className="people-empty">No neighbors match that search.</p>
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
                    <ProfileAvatar
                      profile={person}
                      className="person-avatar"
                      blurred={!person.nameVisible}
                    />
                    <span className="person-summary">
                      <span className={`person-name${person.nameVisible ? "" : " identity-blurred"}`} aria-label={person.nameVisible ? undefined : "Private profile"}>
                        {person.name}
                      </span>
                      <span className="person-detail">{person.job || person.workplace || "Community member"}</span>
                    </span>
                    {latest && <span className="person-message-dot" aria-label="Conversation has messages" />}
                  </button>
                );
              })
            )}
          </div>
          <div className="my-profile-mini">
            <ProfileAvatar profile={user} className="mini-avatar" />
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
                <ProfileAvatar
                  profile={selectedPerson}
                  className="conversation-avatar"
                  blurred={!selectedPerson.nameVisible}
                />
                <span className="conversation-person">
                  <strong className={selectedPerson.nameVisible ? "" : "identity-blurred"} aria-label={selectedPerson.nameVisible ? undefined : "Private profile"}>
                    {selectedPerson.name}
                  </strong>
                  <span>{[selectedPerson.job, selectedPerson.workplace].filter(Boolean).join(" · ") || "Your neighbor"}</span>
                  {selectedPerson.address && <span>{selectedPerson.address}</span>}
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
                        <ProfileAvatar
                          profile={selectedPerson}
                          className="message-avatar"
                          blurred={!selectedPerson.nameVisible}
                        />
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
      )}
    </main>
  );
}

function App() {
  const [mode, setMode] = useState("signup");
  const [accountType, setAccountType] = useState("neighborhood");
  const [form, setForm] = useState(emptyForm);
  const [businessForm, setBusinessForm] = useState(emptyBusinessForm);
  const [user, setUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [error, setError] = useState("");
  const [businessPhotoFiles, setBusinessPhotoFiles] = useState([]);
  const businessPhotoInputRef = useRef(null);

  useEffect(() => {
    request("/api/auth/me")
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((loadError) => {
        if (loadError.status !== 401) {
          setError(loadError.message);
          return;
        }
        request("/api/business/me")
          .then(({ business: currentBusiness }) => {
            setBusiness(currentBusiness);
            setAccountType("business");
          })
          .catch((businessError) => {
            if (businessError.status !== 401) setError(businessError.message);
          });
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

  function changeAccountType(nextAccountType) {
    setAccountType(nextAccountType);
    setError("");
    setLocationStatus("");
    setBusinessPhotoFiles([]);
  }

  function updateBusinessField(event) {
    const { name, value } = event.target;
    setBusinessForm((current) => ({ ...current, [name]: value }));
    if (name === "pincode") setLocationStatus("");
  }

  function updateCredentialField(event) {
    const { name, value } = event.target;
    if (accountType === "business") {
      setBusinessForm((current) => ({ ...current, [name]: value }));
    } else {
      setForm((current) => ({ ...current, [name]: value }));
    }
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

  function detectBusinessLocation() {
    setError("");
    setLocationStatus("Waiting for your location permission…");
    if (!navigator.geolocation) {
      setLocationStatus("Location is not supported by this browser. Enter your address and pincode instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setBusinessForm((current) => ({
          ...current,
          locationConsent: true,
          latitude: String(coords.latitude),
          longitude: String(coords.longitude),
        }));
        try {
          const result = await request(
            `/api/location/reverse?lat=${encodeURIComponent(coords.latitude)}&lon=${encodeURIComponent(coords.longitude)}`,
          );
          setBusinessForm((current) => ({
            ...current,
            pincode: result.pincode || current.pincode,
          }));
          setLocationStatus(
            result.pincode
              ? `Location saved with your business profile. Pincode found: ${result.pincode}.`
              : "Location saved. Enter your business pincode manually.",
          );
        } catch (locationError) {
          setLocationStatus(`${locationError.message} Your coordinates are still saved with the business profile.`);
        }
      },
      (locationError) => {
        const messages = {
          1: "Location permission wasn’t granted. Enter your business address and pincode instead.",
          2: "Your location couldn’t be determined. Enter your business address and pincode instead.",
          3: "Location lookup timed out. Enter your business address and pincode instead.",
        };
        setLocationStatus(messages[locationError.code] || "Location lookup failed. Enter your business address and pincode instead.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (accountType === "business" && mode === "signup") {
      if (businessPhotoFiles.length > 5) {
        setError("Choose no more than 5 business photos.");
        return;
      }
      if (businessPhotoFiles.some((file) => file.size > 4 * 1024 * 1024)) {
        setError("Each business photo must be 4 MB or smaller.");
        return;
      }
    }
    setSubmitting(true);

    try {
      if (accountType === "business" && mode === "signup") {
        const result = await request("/api/business/signup", {
          method: "POST",
          body: JSON.stringify({
            ...businessForm,
            services: businessForm.services
              .split(",")
              .map((service) => service.trim())
              .filter(Boolean),
            latitude: businessForm.locationConsent ? Number(businessForm.latitude) : null,
            longitude: businessForm.locationConsent ? Number(businessForm.longitude) : null,
          }),
        });
        setBusiness(result.business);
        setBusinessForm((current) => ({ ...current, password: "" }));
        const files = businessPhotoFiles;
        if (files.length > 0) {
          const upload = new FormData();
          files.forEach((file) => upload.append("photos", file));
          try {
            const photoResult = await request("/api/business/photos", {
              method: "POST",
              body: upload,
            });
            setBusiness(photoResult.business);
          } catch (photoError) {
            setError(`Your business account was created, but photo upload failed: ${photoError.message}`);
          }
        }
        setBusinessPhotoFiles([]);
        if (businessPhotoInputRef.current) businessPhotoInputRef.current.value = "";
      } else if (accountType === "business") {
        const result = await request("/api/business/signin", {
          method: "POST",
          body: JSON.stringify({ email: businessForm.email, password: businessForm.password }),
        });
        setBusinessForm((current) => ({ ...current, password: "" }));
        setBusiness(result.business);
      } else if (mode === "signup") {
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
      setBusiness(null);
      setForm(emptyForm);
      setBusinessForm(emptyBusinessForm);
      setMode("signin");
    } catch (signOutError) {
      setError(signOutError.message);
    }
  }

  if (loading) {
    return <main className="loading-screen">Getting your neighborhood ready…</main>;
  }

  if (user) {
    return <NeighborhoodDashboard user={user} onSignOut={signOut} onUserUpdated={setUser} />;
  }
  if (business) {
    return (
      <BusinessDashboard
        business={business}
        notice={error}
        onBusinessUpdated={setBusiness}
        onSignOut={async () => {
          try {
            await request("/api/business/signout", { method: "POST" });
            setBusiness(null);
            setBusinessForm(emptyBusinessForm);
            setMode("signin");
          } catch (signOutError) {
            setError(signOutError.message);
          }
        }}
      />
    );
  }

  const isSignup = mode === "signup";
  const isBusiness = accountType === "business";

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
          <div className="account-type-switch" role="tablist" aria-label="Account type">
            <button
              className={isBusiness ? "account-type-tab active" : "account-type-tab"}
              type="button"
              role="tab"
              aria-selected={isBusiness}
              onClick={() => changeAccountType("business")}
            >
              Business
            </button>
            <button
              className={!isBusiness ? "account-type-tab active" : "account-type-tab"}
              type="button"
              role="tab"
              aria-selected={!isBusiness}
              onClick={() => changeAccountType("neighborhood")}
            >
              Neighborhood
            </button>
          </div>
          <p className="eyebrow form-eyebrow">
            {isBusiness
              ? isSignup ? "Create your business profile" : "Business portal"
              : isSignup ? "Join your neighborhood" : "Welcome back"}
          </p>
          <h2>
            {isBusiness
              ? isSignup ? "Bring your business closer." : "Welcome back."
              : isSignup ? "Make yourself at home." : "Good to see you again."}
          </h2>
          <p className="form-intro">
            {isBusiness
              ? isSignup
                ? "Introduce your business to the community and showcase what you offer."
                : "Sign in to manage your business profile and photos."
              : isSignup
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
            {isBusiness && isSignup ? (
              <>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="businessName">Business name <span className="required">*</span></label>
                    <input id="businessName" name="businessName" autoComplete="organization" maxLength="100" placeholder="Your shop or company" value={businessForm.businessName} onChange={updateBusinessField} required />
                  </div>
                  <div className="field">
                    <label htmlFor="category">Business category <span className="required">*</span></label>
                    <select id="category" name="category" value={businessForm.category} onChange={updateBusinessField} required>
                      <option value="">Select a category</option>
                      {["Food & drink", "Retail", "Health & wellness", "Home services", "Education", "Professional services", "Arts & crafts", "Automotive", "Beauty & personal care", "Other"].map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="contactName">Contact person <span className="required">*</span></label>
                    <input id="contactName" name="contactName" autoComplete="name" maxLength="80" placeholder="Your full name" value={businessForm.contactName} onChange={updateBusinessField} required />
                  </div>
                  <div className="field">
                    <label htmlFor="phone">Contact number <span className="required">*</span></label>
                    <input id="phone" name="phone" type="tel" autoComplete="tel" maxLength="20" placeholder="+1 555 123 4567" value={businessForm.phone} onChange={updateBusinessField} required />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="businessAddress">Business address <span className="required">*</span></label>
                  <input id="businessAddress" name="address" autoComplete="street-address" maxLength="240" placeholder="Street address and neighborhood" value={businessForm.address} onChange={updateBusinessField} required />
                </div>
                <div className="field">
                  <div className="label-line">
                    <label htmlFor="businessPincode">Area pincode <span className="required">*</span></label>
                    <button className="location-button" type="button" onClick={detectBusinessLocation}>
                      <span aria-hidden="true">⌖</span> Use my location
                    </button>
                  </div>
                  <input id="businessPincode" name="pincode" autoComplete="postal-code" maxLength="12" placeholder="Enter your business pincode" value={businessForm.pincode} onChange={updateBusinessField} required />
                  <span className="field-hint">Location access is optional. Choosing “Use my location” saves coordinates with your business profile for later location-based features.</span>
                  {locationStatus && <span className="inline-status" role="status">{locationStatus}</span>}
                </div>
                <div className="field">
                  <label htmlFor="description">About the business <span className="optional">Optional</span></label>
                  <textarea id="description" name="description" rows="3" maxLength="2000" placeholder="Tell people what makes your business special…" value={businessForm.description} onChange={updateBusinessField} />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="services">Products or services <span className="optional">Optional</span></label>
                    <input id="services" name="services" maxLength="1000" placeholder="Fresh bread, catering, repairs…" value={businessForm.services} onChange={updateBusinessField} />
                    <span className="field-hint">Separate items with commas.</span>
                  </div>
                  <div className="field">
                    <label htmlFor="openingHours">Opening hours <span className="optional">Optional</span></label>
                    <input id="openingHours" name="openingHours" maxLength="300" placeholder="Mon–Fri, 9 AM–6 PM" value={businessForm.openingHours} onChange={updateBusinessField} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="website">Website <span className="optional">Optional</span></label>
                  <input id="website" name="website" type="url" maxLength="200" placeholder="https://example.com" value={businessForm.website} onChange={updateBusinessField} />
                </div>
                <div className="field">
                  <label htmlFor="businessPhotos">Business photos <span className="optional">Optional · up to 5</span></label>
                  <input
                    id="businessPhotos"
                    ref={businessPhotoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(event) => setBusinessPhotoFiles([...event.target.files])}
                  />
                  <span className="field-hint">JPG, PNG, or WebP, up to 4 MB each. Add shop, product, or portfolio photos.</span>
                </div>
              </>
            ) : !isBusiness && isSignup ? (
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
            ) : null}
            <div className="field">
              <label htmlFor="email">{isBusiness ? "Business email" : "Email address"} <span className="required">*</span></label>
              <input id="email" name="email" type="email" autoComplete="email" maxLength="254" placeholder={isBusiness ? "business@example.com" : "you@example.com"} value={isBusiness ? businessForm.email : form.email} onChange={updateCredentialField} required />
            </div>
            <div className="field">
              <label htmlFor="password">{isBusiness ? "Business password" : "Password"} <span className="required">*</span></label>
              <input id="password" name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 8 : undefined} maxLength="72" placeholder={isSignup ? "At least 8 characters" : "Your password"} value={isBusiness ? businessForm.password : form.password} onChange={updateCredentialField} required />
              {isSignup && <span className="field-hint">Use at least 8 characters.</span>}
            </div>

            {error && <p className="form-error" role="alert">{error}</p>}

            {isSignup && isBusiness && (
              <p className="privacy-note">
                Location is optional. If you choose “Use my location,” your coordinates will be saved with your business profile. You can enter the address manually instead.
              </p>
            )}

            {isSignup && !isBusiness && (
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
            {isBusiness
              ? isSignup ? "Already have a business account?" : "New to the business portal?"
              : isSignup ? "Already part of the neighborhood?" : "New around here?"}{" "}
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
