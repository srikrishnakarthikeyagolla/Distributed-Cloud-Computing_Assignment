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

const emptyServiceProviderForm = {
  name: "",
  email: "",
  password: "",
  phone: "",
  pincode: "",
  services: [],
  serviceDetails: {},
  otherService: "",
  description: "",
  expertise: "",
  yearsExperience: "",
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

function isProductDiscountActive(product, now = Date.now()) {
  if (!Number.isInteger(product.discountPercent) || product.discountPercent < 1) return false;
  if (product.discountType === "ongoing") return true;
  return product.discountType === "timed"
    && Number.isFinite(Date.parse(product.discountEndsAt))
    && Date.parse(product.discountEndsAt) > now;
}

function discountedProductPrice(product) {
  return Math.round(product.price * (100 - product.discountPercent)) / 100;
}

function localDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function DiscountCountdown({ endsAt, now }) {
  const remaining = Math.max(0, Date.parse(endsAt) - now);
  if (!Number.isFinite(remaining) || remaining === 0) return <span className="discount-countdown">Offer ended</span>;
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const timer = days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return <span className="discount-countdown">Offer ends in {timer}</span>;
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

function DealMessageContext({ message, className = "", onCreateDeal, children }) {
  const [menuPosition, setMenuPosition] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [proposal, setProposal] = useState(message.content);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuPosition) return undefined;
    function closeMenu(event) {
      if (event.type === "keydown" && event.key === "Escape") setMenuPosition(null);
      if (event.type === "pointerdown" && !menuRef.current?.contains(event.target)) setMenuPosition(null);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, [menuPosition]);

  function openMenu(event) {
    event.preventDefault();
    const menuWidth = 190;
    const menuHeight = 42;
    setMenuPosition({
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
  }

  async function submitProposal(event) {
    event.preventDefault();
    const content = proposal.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onCreateDeal(content);
      setDialogOpen(false);
      setMenuPosition(null);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        className={`message-row deal-context-target${className ? ` ${className}` : ""}`}
        onContextMenu={openMenu}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            openMenu({
              preventDefault() {},
              clientX: 24,
              clientY: 24,
            });
          }
        }}
        tabIndex={0}
        aria-label="Message. Right-click or use the context menu key to create a deal proposal."
      >
        {children}
      </div>
      {menuPosition && (
        <div
          ref={menuRef}
          className="message-context-menu"
          style={{ left: menuPosition.left, top: menuPosition.top }}
        >
          <button
            type="button"
            onClick={() => {
              setProposal(message.content);
              setError("");
              setDialogOpen(true);
              setMenuPosition(null);
            }}
          >
            Propose message as a deal
          </button>
        </div>
      )}
      {dialogOpen && (
        <div className="deal-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !submitting) setDialogOpen(false);
        }}>
          <form
            className="deal-proposal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="message-deal-heading"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !submitting) setDialogOpen(false);
            }}
            onSubmit={submitProposal}
          >
            <header>
              <p className="eyebrow">Deal proposal</p>
              <h2 id="message-deal-heading">Turn this message into a proposal</h2>
              <p>Review and edit the terms before sending them for acceptance.</p>
            </header>
            <label htmlFor={`message-deal-${message.id}`}>Proposal details</label>
            <textarea
              id={`message-deal-${message.id}`}
              value={proposal}
              onChange={(event) => setProposal(event.target.value)}
              maxLength={2000}
              rows="5"
              required
              autoFocus
            />
            {error && <p className="chat-error" role="alert">{error}</p>}
            <div className="deal-dialog-actions">
              <button
                className="button button-outline"
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button className="button button-primary" type="submit" disabled={!proposal.trim() || submitting}>
                {submitting ? "Sending…" : "Send deal proposal"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function BusinessInbox({ business, initialDealTarget }) {
  const [conversations, setConversations] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversationMode, setConversationMode] = useState(initialDealTarget ? "deals" : "messages");
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
        const targetConversation = initialDealTarget
          ? loaded.find((conversation) => conversation.user.id === initialDealTarget.customer.id)
          : null;
        if (initialDealTarget) {
          setSelectedUser(targetConversation?.user || initialDealTarget.customer);
          setConversationMode("deals");
        } else {
          setSelectedUser((current) => current || loaded[0]?.user || null);
        }
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
    socket.on("business-deal:update", (deal) => {
      if (deal.businessId !== business.id) return;
      request("/api/business/conversations")
        .then((result) => setConversations(result.conversations))
        .catch((loadError) => setError(loadError.message));
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
        if (active) {
          setMessages(loaded);
          setServiceName((current) => current || loaded.at(-1)?.serviceName || "");
        }
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

  async function createDealFromMessage(proposal) {
    if (!selectedUser) throw new Error("Select a customer conversation first.");
    await request(`/api/business/conversations/${encodeURIComponent(selectedUser.id)}/deals`, {
      method: "POST",
      body: JSON.stringify({ proposal }),
    });
    setConversationMode("deals");
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
            <div className="business-chat-mode-switch" role="tablist" aria-label="Conversation type">
              <button
                type="button"
                role="tab"
                aria-selected={conversationMode === "messages"}
                className={conversationMode === "messages" ? "active" : ""}
                onClick={() => setConversationMode("messages")}
              >
                Messages
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={conversationMode === "deals"}
                className={conversationMode === "deals" ? "active" : ""}
                onClick={() => setConversationMode("deals")}
              >
                Deals
              </button>
            </div>
            {conversationMode === "deals" ? (
              <DealCenter
                accountType="business"
                userId={selectedUser.id}
                businessId={business.id}
                businessName={business.businessName}
                focusedDealId={initialDealTarget?.dealId}
              />
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
                  <DealMessageContext
                    className={ownMessage ? "own-message" : ""}
                    key={message.id}
                    message={message}
                    onCreateDeal={createDealFromMessage}
                  >
                    <div className="message-content">
                      <span className="message-sender">{ownMessage ? business.businessName : selectedUser.name}</span>
                      <p>{message.content}</p>
                      <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                    </div>
                  </DealMessageContext>
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
          </>
        )}
      </section>
    </section>
  );
}

function ServiceCatalogPicker({
  catalog,
  selectedServices,
  onServicesChange,
  otherService,
  onOtherServiceChange,
  search,
  onSearchChange,
}) {
  const filteredServices = catalog.filter((service) => service.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  function toggleService(service) {
    onServicesChange((current) => current.includes(service)
      ? current.filter((item) => item !== service)
      : [...current, service]);
  }

  return (
    <div className="service-catalog-picker">
      <label className="sr-only" htmlFor="service-catalog-search">Search available services</label>
      <input
        id="service-catalog-search"
        type="search"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search 100+ services…"
      />
      <span className="field-hint">Choose one or more services. Select “Other” to add a custom service.</span>
      <div className="service-catalog-options">
        {filteredServices.map((service) => (
          <label key={service} className="service-catalog-option">
            <input
              type="checkbox"
              checked={selectedServices.includes(service)}
              onChange={() => toggleService(service)}
            />
            <span>{service}</span>
          </label>
        ))}
        {filteredServices.length === 0 && <p className="product-catalog-empty">No services match that search.</p>}
      </div>
      {selectedServices.some((service) => service.toLocaleLowerCase() === "other") && (
        <label className="field">
          Describe your other service
          <input
            type="text"
            value={otherService}
            onChange={(event) => onOtherServiceChange(event.target.value)}
            maxLength="80"
            placeholder="Describe the service you provide"
            required
          />
        </label>
      )}
      <div className="selected-service-chips" aria-label="Selected services">
        {selectedServices.map((service) => (
          <button type="button" className="interest-chip" key={service} onClick={() => toggleService(service)}>
            {service} <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ServiceDetailsEditor({ services, serviceDetails, otherService, onDetailsChange }) {
  function updateService(serviceName, field, value) {
    onDetailsChange((current) => ({
      ...current,
      [serviceName]: {
        ...(current[serviceName] || {}),
        [field]: value,
      },
    }));
  }

  if (services.length === 0) return null;

  return (
    <div className="service-details-editor">
      <p className="field-hint">Add a short description for every selected service. Usual prices are optional.</p>
      {services.map((serviceName) => {
        const label = serviceName === "Other" ? otherService || "Other service" : serviceName;
        const details = serviceDetails[serviceName] || {};
        return (
          <fieldset className="service-details-fieldset" key={serviceName}>
            <legend>{label}</legend>
            <label>
              Service details <span className="required">*</span>
              <textarea
                rows="2"
                maxLength="1000"
                value={details.description || ""}
                onChange={(event) => updateService(serviceName, "description", event.target.value)}
                placeholder={`Describe your ${label.toLocaleLowerCase()} service`}
                required
              />
            </label>
            <label>
              Usual price in ₹ <span className="optional">Optional</span>
              <input
                type="number"
                min="0"
                max="10000000"
                step="0.01"
                value={details.usualPrice ?? ""}
                onChange={(event) => updateService(serviceName, "usualPrice", event.target.value)}
                placeholder="Leave blank if price varies"
              />
            </label>
          </fieldset>
        );
      })}
    </div>
  );
}

function ServicesMarketplace({ user, initialView = "explore" }) {
  const [activeView, setActiveView] = useState(initialView);
  const [providers, setProviders] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [selectedService, setSelectedService] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("messages");
  const [focusedDealId, setFocusedDealId] = useState(null);
  const [error, setError] = useState("");
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const visibleProviders = providers.filter((provider) => !serviceFilter
    || (Array.isArray(provider.services) && provider.services.includes(serviceFilter))
    || (serviceFilter === "Other" && provider.otherService));
  const visibleServiceCatalog = serviceCatalog.filter((service) =>
    service.toLocaleLowerCase().includes(serviceSearch.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    let active = true;
    request("/api/service-providers/catalog")
      .then(({ services }) => {
        if (active) setServiceCatalog(services);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (activeView !== "explore") return undefined;
    let active = true;
    setLoadingProviders(true);
    const timerId = window.setTimeout(() => {
      request(`/api/service-providers/directory?search=${encodeURIComponent(search)}&service=${encodeURIComponent(serviceFilter)}`)
        .then(({ serviceProviders: loaded }) => {
          if (active) setProviders(loaded);
        })
        .catch((loadError) => {
          if (active) setError(loadError.message);
        })
        .finally(() => {
          if (active) setLoadingProviders(false);
        });
    }, search ? 220 : 0);
    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [activeView, search, serviceFilter]);

  useEffect(() => {
    if (activeView !== "chats") return undefined;
    let active = true;
    request("/api/service-providers/my-conversations")
      .then(({ conversations: loaded }) => {
        if (!active) return;
        setConversations(loaded);
        setSelectedProvider((current) => current || loaded[0]?.serviceProvider || null);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      });
    return () => {
      active = false;
    };
  }, [activeView]);

  useEffect(() => {
    if (!selectedProvider) {
      setMessages([]);
      return undefined;
    }
    let active = true;
    setLoadingMessages(true);
    request(`/api/service-providers/providers/${encodeURIComponent(selectedProvider.id)}/messages`)
      .then(({ messages: loaded }) => {
        if (active) {
          setMessages(loaded);
          setSelectedService((current) => {
            if (current && selectedProvider.services?.includes(current)) return current;
            return loaded.at(-1)?.serviceName || "";
          });
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoadingMessages(false);
      });
    return () => {
      active = false;
    };
  }, [selectedProvider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    const socket = io({ withCredentials: true });
    socket.on("service-chat:message", (message) => {
      if (message.userId !== user.id) return;
      if (message.serviceProviderId === selectedProvider?.id && mode === "messages") {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      }
      request("/api/service-providers/my-conversations")
        .then((result) => setConversations(result.conversations))
        .catch((loadError) => setError(loadError.message));
    });
    socket.on("service-deal:update", (deal) => {
      if (deal.userId !== user.id) return;
      request("/api/service-providers/my-conversations")
        .then((result) => setConversations(result.conversations))
        .catch((loadError) => setError(loadError.message));
    });
    return () => socket.disconnect();
  }, [user.id, selectedProvider?.id, mode]);

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedProvider || sending) return;
    setSending(true);
    setError("");
    try {
      const { message } = await request(
        `/api/service-providers/providers/${encodeURIComponent(selectedProvider.id)}/messages`,
        { method: "POST", body: JSON.stringify({ content, serviceName: selectedService }) },
      );
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      setDraft("");
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  function openProvider(provider, nextServiceName = "", nextMode = "messages", dealId = null) {
    if (!provider?.id) {
      setError("This service provider is no longer available. Refresh the services list and try again.");
      return;
    }
    setSelectedProvider(provider);
    setSelectedService(nextServiceName);
    setMode(nextMode);
    setFocusedDealId(dealId);
    setError("");
    setActiveView("chats");
  }

  return (
    <section className="services-marketplace" aria-label="Local services">
      <nav className="business-section-nav" aria-label="Services section">
        <button type="button" className={activeView === "explore" ? "active" : ""} aria-current={activeView === "explore" ? "page" : undefined} onClick={() => setActiveView("explore")}>Find a service</button>
        <button type="button" className={activeView === "chats" ? "active" : ""} aria-current={activeView === "chats" ? "page" : undefined} onClick={() => setActiveView("chats")}>
          Service chats{conversations.length > 0 && <span className="nav-count">{conversations.length}</span>}
        </button>
        <button type="button" className={activeView === "deals" ? "active" : ""} aria-current={activeView === "deals" ? "page" : undefined} onClick={() => setActiveView("deals")}>Active deals</button>
      </nav>
      {error && <p className="chat-error dashboard-error" role="alert">{error}</p>}
      {activeView === "explore" ? (
        <section className="services-directory" aria-label="Service providers in your pincode">
          <section className="service-discovery" aria-label="Browse available services">
            <div className="service-discovery-heading">
              <div><p className="eyebrow">What do you need?</p><h2>Browse local services</h2></div>
              <label className="service-discovery-search">
                <span aria-hidden="true">⌕</span>
                <input type="search" value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} placeholder="Search services" aria-label="Search services" />
              </label>
            </div>
            <div className="service-category-grid">
              {visibleServiceCatalog.slice(0, 20).map((service) => (
                <button
                  type="button"
                  className={`service-category-tile${serviceFilter === service ? " selected" : ""}`}
                  key={service}
                  onClick={() => {
                    setServiceFilter((current) => current === service ? "" : service);
                    setSearch("");
                  }}
                  aria-pressed={serviceFilter === service}
                >
                  <span className="service-category-icon" aria-hidden="true">{service.charAt(0)}</span>
                  <span>{service}</span>
                </button>
              ))}
              {visibleServiceCatalog.length === 0 && <p className="people-empty">No services match that search.</p>}
            </div>
          </section>
          <header className="connections-heading">
            <div>
              <p className="eyebrow">Local services · {user.pincode}</p>
              <h2>Find trusted help nearby</h2>
              <p>{serviceFilter ? `Showing providers offering ${serviceFilter}.` : "Search local providers by name, service, or expertise."}</p>
            </div>
            <div className="service-search-controls">
              <label className="connections-search">
                <span aria-hidden="true">⌕</span>
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. plumbing, AC repair, tutor" aria-label="Search local service providers" />
              </label>
              <label className="sr-only" htmlFor="service-category-filter">Filter by service</label>
              <select id="service-category-filter" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
                <option value="">All services</option>
                {serviceCatalog.map((service) => <option value={service} key={service}>{service}</option>)}
              </select>
            </div>
          </header>
          {loadingProviders ? (
            <div className="connections-empty"><h3>Finding service providers nearby…</h3></div>
          ) : visibleProviders.length === 0 ? (
            <div className="connections-empty">
              <h3>{search || serviceFilter ? "No providers match those filters." : "No service providers listed in your area yet."}</h3>
              <p>{search || serviceFilter ? "Try another name, service, or clear the service filter." : "Try again later as local professionals join."}</p>
            </div>
          ) : (
            <div className="service-provider-grid">
              {visibleProviders.map((provider) => (
                <article className="service-provider-card" key={provider.id}>
                  <div className="service-provider-card-heading">
                    <span className="service-provider-avatar">{provider.name.charAt(0).toUpperCase()}</span>
                    <div><h3>{provider.name}</h3><span>{provider.yearsExperience == null ? "Local service provider" : `${provider.yearsExperience} years of experience`}</span></div>
                  </div>
                  <div className="service-provider-offers">
                    {(Array.isArray(provider.services) ? provider.services : []).map((service) => {
                      const details = provider.serviceDetails?.[service] || {};
                      const serviceLabel = service === "Other" ? provider.otherService || service : service;
                      return (
                        <article className={`service-offer-card${serviceFilter === service ? " highlighted" : ""}`} key={service}>
                          <div className="service-offer-heading">
                            <strong>{serviceLabel}</strong>
                            {details.usualPrice != null && <span>Usually ₹{Number(details.usualPrice).toLocaleString("en-IN")}</span>}
                          </div>
                          <p>{details.description || provider.description || "Contact this provider for service details."}</p>
                          <button className="button button-outline" type="button" onClick={() => openProvider(provider, service)}>
                            Message about {serviceLabel}
                          </button>
                          <ServiceReviews
                            provider={provider}
                            serviceName={service}
                            serviceLabel={serviceLabel}
                          />
                        </article>
                      );
                    })}
                  </div>
                  {provider.expertise && <p className="service-provider-expertise"><strong>Expertise</strong> {provider.expertise}</p>}
                  {provider.description && <p className="service-provider-description">{provider.description}</p>}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : activeView === "deals" ? (
        <ActiveDealsView
          accountType="serviceCustomer"
          accountId={user.id}
          onOpenDeal={(deal) => openProvider(deal.provider, deal.serviceName || "", "deals", deal.id)}
        />
      ) : (
        <section className="community-layout service-customer-inbox" aria-label="Service provider messages">
          <aside className="people-panel">
            <div className="people-panel-heading"><div><h2>Service chats</h2><p>{conversations.length} conversations</p></div><span className="people-count">{conversations.length}</span></div>
            <div className="people-list">
              {conversations.length === 0 ? (
                <div className="people-empty"><strong>No service chats yet.</strong><span>Find a provider nearby to start a conversation.</span><button className="button button-outline" type="button" onClick={() => setActiveView("explore")}>Find a service</button></div>
              ) : conversations.map(({ serviceProvider: provider, lastMessage }) => (
                <button className={`person-row${selectedProvider?.id === provider.id ? " selected" : ""}`} key={provider.id} type="button" onClick={() => { setSelectedProvider(provider); setSelectedService(lastMessage?.serviceName || ""); setMode("messages"); setFocusedDealId(null); }}>
                  <span className="avatar person-avatar">{provider.name.charAt(0).toUpperCase()}</span>
                  <span className="person-summary"><span className="person-name">{provider.name}</span><span className="person-detail">{lastMessage?.serviceName ? `${lastMessage.serviceName} · ` : ""}{lastMessage?.content || "Open conversation"}</span></span>
                </button>
              ))}
            </div>
          </aside>
          <section className="conversation-panel" aria-label="Service provider conversation">
            {!selectedProvider ? (
              <div className="conversation-empty"><h2>Find local help and talk directly.</h2><p>Choose a provider from your service chats or browse the directory.</p><button className="button button-outline" type="button" onClick={() => setActiveView("explore")}>Find a service</button></div>
            ) : (
              <>
                <header className="conversation-header">
                  <span className="avatar conversation-avatar">{selectedProvider.name.charAt(0).toUpperCase()}</span>
                  <span className="conversation-person"><strong>{selectedProvider.name}</strong><span>{(Array.isArray(selectedProvider.services) ? selectedProvider.services : []).join(" · ")}</span></span>
                </header>
                <label className="service-context-picker">
                  Service you need
                  <select value={selectedService} onChange={(event) => setSelectedService(event.target.value)} required>
                    <option value="">Choose a service…</option>
                    {(Array.isArray(selectedProvider.services) ? selectedProvider.services : []).map((service) => (
                      <option key={service} value={service}>{service === "Other" ? selectedProvider.otherService || service : service}</option>
                    ))}
                  </select>
                </label>
                {selectedService && (
                  <p className="service-context-summary">
                    {selectedProvider.serviceDetails?.[selectedService]?.description || "Service conversation"}
                    {selectedProvider.serviceDetails?.[selectedService]?.usualPrice != null && (
                      <strong> · Usually ₹{Number(selectedProvider.serviceDetails[selectedService].usualPrice).toLocaleString("en-IN")}</strong>
                    )}
                  </p>
                )}
                <div className="business-chat-mode-switch" role="tablist" aria-label="Service chat type">
                  <button type="button" role="tab" aria-selected={mode === "messages"} className={mode === "messages" ? "active" : ""} onClick={() => setMode("messages")}>Messages</button>
                  <button type="button" role="tab" aria-selected={mode === "deals"} className={mode === "deals" ? "active" : ""} onClick={() => setMode("deals")}>Deals</button>
                </div>
                {mode === "deals" ? (
                  <DealCenter
                    accountType="serviceCustomer"
                    userId={user.id}
                    businessId={selectedProvider.id}
                    businessName={selectedProvider.name}
                    focusedDealId={focusedDealId}
                    serviceName={selectedService}
                    serviceDisplayName={selectedService === "Other" ? selectedProvider.otherService || "Other" : selectedService}
                    otherServiceDisplayName={selectedProvider.otherService || "Other"}
                  />
                ) : (
                  <>
                    <div className="messages-area" aria-live="polite">
                      {loadingMessages && messages.length === 0 ? <p className="messages-loading">Opening chat…</p> : messages.map((message) => {
                        const ownMessage = message.senderType === "user";
                        return <div className={`message-row${ownMessage ? " own-message" : ""}`} key={message.id}><div className="message-content"><span className="message-sender">{ownMessage ? "You" : selectedProvider.name}</span>{message.serviceName && <span className="service-message-tag">{message.serviceName === "Other" ? selectedProvider.otherService || message.serviceName : message.serviceName}</span>}<p>{message.content}</p><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div></div>;
                      })}
                      {!loadingMessages && messages.length === 0 && <div className="conversation-start"><strong>Start a conversation with {selectedProvider.name}.</strong><span>Describe the service you need and ask any questions.</span></div>}
                      <div ref={messagesEndRef} />
                    </div>
                    <form className="message-composer" onSubmit={sendMessage}>
                      <label className="sr-only" htmlFor="service-customer-message">Write a message</label>
                      <textarea id="service-customer-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength="2000" rows="2" placeholder={`Message ${selectedProvider.name}…`} disabled={sending} />
                      <button className="button button-primary" type="submit" disabled={!draft.trim() || !selectedService || sending}>{sending ? "Sending…" : "Send message"}</button>
                    </form>
                  </>
                )}
              </>
            )}
          </section>
        </section>
      )}
    </section>
  );
}

function ServiceProviderInbox({ serviceProvider, initialDealTarget }) {
  const [conversations, setConversations] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(initialDealTarget?.customer || null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState(initialDealTarget ? "deals" : "messages");
  const [focusedDealId, setFocusedDealId] = useState(initialDealTarget?.dealId || null);
  const [serviceName, setServiceName] = useState(initialDealTarget?.serviceName || "");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let active = true;
    request("/api/service-providers/conversations")
      .then(({ conversations: loaded }) => {
        if (active) {
          setConversations(loaded);
          if (!initialDealTarget) {
            setSelectedCustomer((current) => current || loaded[0]?.user || null);
            setServiceName((current) => current || loaded[0]?.lastMessage?.serviceName || "");
          }
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      });
    const socket = io({ withCredentials: true });
    socket.on("service-chat:message", (message) => {
      if (message.serviceProviderId !== serviceProvider.id) return;
      if (message.userId === selectedCustomer?.id && mode === "messages") {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        if (message.senderType === "user" && message.serviceName) setServiceName(message.serviceName);
      }
      request("/api/service-providers/conversations")
        .then((result) => setConversations(result.conversations))
        .catch((loadError) => setError(loadError.message));
    });
    socket.on("service-deal:update", (deal) => {
      if (deal.serviceProviderId !== serviceProvider.id) return;
      request("/api/service-providers/conversations")
        .then((result) => setConversations(result.conversations))
        .catch((loadError) => setError(loadError.message));
    });
    return () => {
      active = false;
      socket.disconnect();
    };
  }, [serviceProvider.id, selectedCustomer?.id, mode]);

  useEffect(() => {
    if (!selectedCustomer) {
      setMessages([]);
      return undefined;
    }
    let active = true;
    setLoadingMessages(true);
    request(`/api/service-providers/conversations/${encodeURIComponent(selectedCustomer.id)}/messages`)
      .then(({ messages: loaded }) => {
        if (active) {
          setMessages(loaded);
          if (!initialDealTarget) setServiceName(loaded.at(-1)?.serviceName || "");
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoadingMessages(false);
      });
    return () => {
      active = false;
    };
  }, [selectedCustomer]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedCustomer || sending) return;
    setSending(true);
    setError("");
    try {
      const { message } = await request(
        `/api/service-providers/conversations/${encodeURIComponent(selectedCustomer.id)}/messages`,
        { method: "POST", body: JSON.stringify({ content, serviceName }) },
      );
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      setDraft("");
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  function openDeal(deal) {
    setSelectedCustomer(deal.customer);
    setFocusedDealId(deal.id);
    setServiceName(deal.serviceName || "");
    setMode("deals");
  }

  return (
    <section className="community-layout service-provider-inbox" aria-label="Service customer chats">
      <aside className="people-panel">
        <div className="people-panel-heading">
          <div><h2>Service chats</h2><p>{conversations.length} conversations</p></div>
          <span className="people-count">{conversations.length}</span>
        </div>
        <div className="people-list">
          {conversations.length === 0 ? (
            <p className="people-empty">Customer chats and service deals will appear here.</p>
          ) : conversations.map(({ user, lastMessage }) => (
            <button
              className={`person-row${selectedCustomer?.id === user.id ? " selected" : ""}`}
              key={user.id}
              type="button"
              onClick={() => {
                setSelectedCustomer(user);
                setServiceName(lastMessage?.serviceName || "");
                setMode("messages");
                setError("");
              }}
            >
              <span className="avatar person-avatar">{user.name.charAt(0).toUpperCase()}</span>
              <span className="person-summary">
                <span className="person-name">{user.name}</span>
                <span className="person-detail">{lastMessage?.serviceName ? `${lastMessage.serviceName} · ` : ""}{lastMessage?.content || "Open conversation"}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="conversation-panel" aria-label="Service customer conversation">
        {!selectedCustomer ? (
          <div className="conversation-empty"><h2>Connect with local customers.</h2><p>Your conversations will appear here.</p></div>
        ) : (
          <>
            <header className="conversation-header">
              <span className="avatar conversation-avatar">{selectedCustomer.name.charAt(0).toUpperCase()}</span>
              <span className="conversation-person"><strong>{selectedCustomer.name}</strong><span>Customer in your service area</span></span>
            </header>
            <label className="service-context-picker">
              Service being discussed
              <select value={serviceName} onChange={(event) => setServiceName(event.target.value)} required>
                <option value="">Choose a service…</option>
                {(Array.isArray(serviceProvider.services) ? serviceProvider.services : []).map((service) => (
                  <option key={service} value={service}>{service === "Other" ? serviceProvider.otherService || service : service}</option>
                ))}
              </select>
            </label>
            {serviceName && (
              <p className="service-context-summary">
                {serviceProvider.serviceDetails?.[serviceName]?.description || "Service conversation"}
                {serviceProvider.serviceDetails?.[serviceName]?.usualPrice != null && (
                  <strong> · Usual price ₹{Number(serviceProvider.serviceDetails[serviceName].usualPrice).toLocaleString("en-IN")}</strong>
                )}
              </p>
            )}
            <div className="business-chat-mode-switch" role="tablist" aria-label="Service conversation type">
              <button type="button" role="tab" aria-selected={mode === "messages"} className={mode === "messages" ? "active" : ""} onClick={() => setMode("messages")}>Messages</button>
              <button type="button" role="tab" aria-selected={mode === "deals"} className={mode === "deals" ? "active" : ""} onClick={() => setMode("deals")}>Deals</button>
            </div>
            {mode === "deals" ? (
              <DealCenter
                accountType="serviceProvider"
                userId={selectedCustomer.id}
                businessId={serviceProvider.id}
                businessName={selectedCustomer.name}
                focusedDealId={focusedDealId}
                serviceName={serviceName}
                serviceDisplayName={serviceName === "Other" ? serviceProvider.otherService || "Other" : serviceName}
                otherServiceDisplayName={serviceProvider.otherService || "Other"}
              />
            ) : (
              <>
                <div className="messages-area" aria-live="polite">
                  {loadingMessages && messages.length === 0 ? <p className="messages-loading">Opening chat…</p> : messages.map((message) => {
                    const ownMessage = message.senderType === "serviceProvider";
                    return (
                      <div className={`message-row${ownMessage ? " own-message" : ""}`} key={message.id}>
                        <div className="message-content">
                          <span className="message-sender">{ownMessage ? serviceProvider.name : selectedCustomer.name}</span>
                          {message.serviceName && <span className="service-message-tag">{message.serviceName === "Other" ? serviceProvider.otherService || message.serviceName : message.serviceName}</span>}
                          <p>{message.content}</p>
                          <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                        </div>
                      </div>
                    );
                  })}
                  {!loadingMessages && messages.length === 0 && <div className="conversation-start"><strong>Start a service conversation.</strong><span>Discuss what the customer needs before proposing a service deal.</span></div>}
                  <div ref={messagesEndRef} />
                </div>
                {error && <p className="chat-error" role="alert">{error}</p>}
                <form className="message-composer" onSubmit={sendMessage}>
                  <label className="sr-only" htmlFor="service-provider-message">Write a message</label>
                  <textarea id="service-provider-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows="2" placeholder={`Message ${selectedCustomer.name}…`} disabled={sending} />
                  <button className="button button-primary" type="submit" disabled={!draft.trim() || !serviceName || sending}>{sending ? "Sending…" : "Send message"}</button>
                </form>
              </>
            )}
          </>
        )}
      </section>
    </section>
  );
}

function ServiceProviderDashboard({ serviceProvider, serviceCatalog, onServiceProviderUpdated, onSignOut }) {
  const [activeView, setActiveView] = useState("profile");
  const [dealTarget, setDealTarget] = useState(null);
  const [name, setName] = useState(serviceProvider.name);
  const [phone, setPhone] = useState(serviceProvider.phone);
  const [pincode, setPincode] = useState(serviceProvider.pincode);
  const [description, setDescription] = useState(serviceProvider.description || "");
  const [expertise, setExpertise] = useState(serviceProvider.expertise || "");
  const [yearsExperience, setYearsExperience] = useState(serviceProvider.yearsExperience ?? "");
  const [selectedServices, setSelectedServices] = useState(serviceProvider.services || []);
  const [serviceDetails, setServiceDetails] = useState(serviceProvider.serviceDetails || {});
  const [otherService, setOtherService] = useState(serviceProvider.otherService || "");
  const [serviceSearch, setServiceSearch] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const { serviceProvider: updated } = await request("/api/service-providers/profile", {
        method: "PUT",
        body: JSON.stringify({
          name,
          email: serviceProvider.email,
          phone,
          pincode,
          services: selectedServices,
          serviceDetails,
          otherService,
          description,
          expertise,
          yearsExperience,
        }),
      });
      onServiceProviderUpdated(updated);
      setStatus("Your service profile has been updated.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="business-dashboard service-provider-dashboard">
      <header className="business-topbar">
        <a className="brand" href="/" aria-label="Commonground home"><span className="brand-mark">c.</span><span>common<span className="brand-light">ground</span></span></a>
        <nav className="topbar-nav" aria-label="Service provider navigation">
          <button className={`nav-button${activeView === "profile" ? " active" : ""}`} type="button" onClick={() => setActiveView("profile")}>Profile</button>
          <button className={`nav-button${activeView === "chats" ? " active" : ""}`} type="button" onClick={() => { setDealTarget(null); setActiveView("chats"); }}>Service chats</button>
          <button className={`nav-button${activeView === "deals" ? " active" : ""}`} type="button" onClick={() => setActiveView("deals")}>Active deals</button>
          <button className={`nav-button${activeView === "reviews" ? " active" : ""}`} type="button" onClick={() => setActiveView("reviews")}>Reviews</button>
        </nav>
        <div className="business-topbar-actions"><span>Service provider</span><button className="button button-outline" type="button" onClick={onSignOut}>Sign out</button></div>
      </header>
      <section className="business-dashboard-heading">
        <p className="eyebrow">{activeView === "profile" ? "Your services" : activeView === "chats" ? "Customer support" : activeView === "reviews" ? "Customer feedback" : "Service agreements"}</p>
        <h1>{serviceProvider.name}</h1>
        <p>{serviceProvider.pincode} · {(Array.isArray(serviceProvider.services) ? serviceProvider.services : []).slice(0, 3).join(", ")}</p>
      </section>
      {activeView === "profile" ? (
        <form className="service-provider-profile-form" onSubmit={saveProfile}>
          <h2>Service provider profile</h2>
          <p>Tell nearby customers about your experience and what you offer.</p>
          <div className="product-editor-fields">
            <label>Your name<input value={name} onChange={(event) => setName(event.target.value)} maxLength="80" required /></label>
            <label>Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength="20" required /></label>
            <label>Area pincode<input value={pincode} onChange={(event) => setPincode(event.target.value)} maxLength="6" pattern="[0-9]{6}" required /></label>
            <label>Years of experience<input type="number" min="0" max="80" value={yearsExperience} onChange={(event) => setYearsExperience(event.target.value)} /></label>
          </div>
          <label>Services you provide
            <ServiceCatalogPicker
              catalog={serviceCatalog}
              selectedServices={selectedServices}
              onServicesChange={(update) => {
                const nextServices = typeof update === "function" ? update(selectedServices) : update;
                setSelectedServices(nextServices);
                setServiceDetails((current) => Object.fromEntries(
                  Object.entries(current).filter(([service]) => nextServices.includes(service)),
                ));
              }}
              otherService={otherService}
              onOtherServiceChange={setOtherService}
              search={serviceSearch}
              onSearchChange={setServiceSearch}
            />
          </label>
          <ServiceDetailsEditor
            services={selectedServices}
            serviceDetails={serviceDetails}
            otherService={otherService}
            onDetailsChange={setServiceDetails}
          />
          <label>Your expertise<textarea rows="4" maxLength="2000" value={expertise} onChange={(event) => setExpertise(event.target.value)} placeholder="Describe your training, experience, or special skills." /></label>
          <label>What you offer<textarea rows="4" maxLength="2000" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Share availability, service details, and what customers can expect." /></label>
          {error && <p className="chat-error" role="alert">{error}</p>}
          {status && <p className="profile-feedback success" role="status">{status}</p>}
          <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
        </form>
      ) : activeView === "chats" ? (
        <ServiceProviderInbox serviceProvider={serviceProvider} initialDealTarget={dealTarget} />
      ) : activeView === "reviews" ? (
        <ServiceProviderReviews serviceProvider={serviceProvider} />
      ) : (
        <ActiveDealsView
          accountType="serviceProvider"
          accountId={serviceProvider.id}
          otherService={serviceProvider.otherService}
          onOpenDeal={(deal) => {
            setDealTarget({ customer: deal.customer, dealId: deal.id, serviceName: deal.serviceName || "" });
            setActiveView("chats");
          }}
        />
      )}
    </main>
  );
}

function BusinessProductsManager() {
  const [products, setProducts] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [discountType, setDiscountType] = useState("none");
  const [trackInventory, setTrackInventory] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    request("/api/business/products")
      .then(({ products: loaded }) => {
        if (active) setProducts(loaded);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveProduct(event) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    setSaving(true);
    setError("");
    setStatus("");
    const formData = new FormData(form);
    const photo = formData.get("photo");
    if (!(photo instanceof File) || !photo.name) formData.delete("photo");
    const localEndTime = formData.get("discountEndsAt");
    if (discountType === "timed" && typeof localEndTime === "string" && localEndTime) {
      const endTimestamp = new Date(localEndTime).getTime();
      if (Number.isFinite(endTimestamp)) formData.set("discountEndsAt", new Date(endTimestamp).toISOString());
    }
    try {
      const productId = editingProduct?.id;
      const result = await request(
        productId ? `/api/business/products/${encodeURIComponent(productId)}` : "/api/business/products",
        {
          method: productId ? "PUT" : "POST",
          body: formData,
        },
      );
      setProducts((current) => productId
        ? current.map((product) => product.id === result.product.id ? result.product : product)
        : [...current, result.product]);
      setEditingProduct(null);
      setDiscountType("none");
      setTrackInventory(false);
      form.reset();
      setStatus(productId ? "Product updated." : "Product added to your catalog.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateAvailability(product) {
    setError("");
    setStatus("");
    try {
      const { product: updatedProduct } = await request(
        `/api/business/products/${encodeURIComponent(product.id)}/availability`,
        {
          method: "PATCH",
          body: JSON.stringify({ available: !product.available }),
        },
      );
      setProducts((current) => current.map((item) => item.id === updatedProduct.id ? updatedProduct : item));
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function removeProduct(product) {
    if (!window.confirm(`Delete “${product.name}” from your catalog?`)) return;
    setError("");
    setStatus("");
    try {
      await request(`/api/business/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      setProducts((current) => current.filter((item) => item.id !== product.id));
      if (editingProduct?.id === product.id) {
        setEditingProduct(null);
        setDiscountType("none");
        setTrackInventory(false);
      }
      setStatus("Product deleted.");
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  return (
    <section className="business-products-manager" aria-labelledby="business-products-heading">
      <header className="business-gallery-heading">
        <div>
          <p className="eyebrow">Catalog</p>
          <h2 id="business-products-heading">Your products</h2>
          <p>Add, update, or temporarily mark products unavailable.</p>
        </div>
        <span className="people-count">{products.length}</span>
      </header>
      <form className="product-editor-form" key={editingProduct?.id || "new-product"} onSubmit={saveProduct}>
        <h3>{editingProduct ? "Edit product" : "Add a product"}</h3>
        <div className="product-editor-fields">
          <label>
            Item name
            <input name="name" defaultValue={editingProduct?.name || ""} maxLength={100} required />
          </label>
          <label>
            Price
            <input name="price" type="number" min="0" max="99999999" step="0.01" defaultValue={editingProduct?.price ?? ""} required />
          </label>
        </div>
        <fieldset className="product-discount-fields">
          <legend>Product discount</legend>
          <label>
            Discount type
            <select
              value={discountType}
              onChange={(event) => setDiscountType(event.target.value)}
            >
              <option value="none">No discount</option>
              <option value="ongoing">Ongoing discount</option>
              <option value="timed">Limited-time discount</option>
            </select>
          </label>
          {discountType !== "none" && (
            <div className="product-editor-fields">
              <label>
                Discount percentage
                <input
                  name="discountPercent"
                  type="number"
                  min="1"
                  max="99"
                  step="1"
                  defaultValue={editingProduct?.discountPercent || ""}
                  required
                />
              </label>
              {discountType === "timed" && (
                <label>
                  Offer ends at
                  <input
                    name="discountEndsAt"
                    type="datetime-local"
                    min={localDateTimeValue(new Date(now + 60_000).toISOString())}
                    defaultValue={localDateTimeValue(editingProduct?.discountEndsAt)}
                    required
                  />
                </label>
              )}
            </div>
          )}
          <input type="hidden" name="discountType" value={discountType} />
          {discountType === "none" && <input type="hidden" name="discountPercent" value="0" />}
        </fieldset>
        <fieldset className="product-inventory-fields">
          <legend>Stock tracking <span className="optional">Optional</span></legend>
          <label className="product-inventory-toggle">
            <input
              type="checkbox"
              checked={trackInventory}
              onChange={(event) => setTrackInventory(event.target.checked)}
            />
            <span>Track the quantity in stock for this product</span>
          </label>
          <input type="hidden" name="trackInventory" value={trackInventory ? "true" : "false"} />
          {trackInventory ? (
            <label>
              Quantity in stock
              <input
                name="stockQuantity"
                type="number"
                min="0"
                max="1000000"
                step="1"
                defaultValue={editingProduct?.trackInventory ? editingProduct.stockQuantity : ""}
                required
              />
              <span className="field-hint">Orders reduce this quantity automatically. Set 0 to mark it sold out.</span>
            </label>
          ) : (
            <>
              <p className="field-hint">Leave stock tracking off for made-to-order or unlimited items like pizza.</p>
              <input type="hidden" name="stockQuantity" value="0" />
            </>
          )}
        </fieldset>
        <label>
          Description
          <textarea name="description" rows="3" maxLength={2000} defaultValue={editingProduct?.description || ""} placeholder="Describe this product…" />
        </label>
        <label>
          Product photo {editingProduct ? <span className="optional">Optional · leave blank to keep current photo</span> : <span className="required">*</span>}
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required={!editingProduct} />
          <span className="field-hint">JPG, PNG, or WebP · 4 MB maximum</span>
        </label>
        {error && <p className="chat-error" role="alert">{error}</p>}
        {status && <p className="profile-feedback success" role="status">{status}</p>}
        <div className="product-editor-actions">
          {editingProduct && (
            <button className="button button-outline" type="button" onClick={() => {
              setEditingProduct(null);
              setDiscountType("none");
              setTrackInventory(false);
            }}>
              Cancel edit
            </button>
          )}
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : editingProduct ? "Save changes" : "Add product"}
          </button>
        </div>
      </form>
      {loading ? (
        <p className="deal-empty">Loading products…</p>
      ) : products.length === 0 ? (
        <p className="deal-empty">Your products will appear here after you add them.</p>
      ) : (
        <div className="managed-products-grid">
          {products.map((product) => (
            <article className={`managed-product-card${product.available ? "" : " unavailable"}`} key={product.id}>
              <img src={product.photoUrl} alt={product.name} />
              <div>
                <span className={`product-availability${product.available ? "" : " unavailable"}`}>
                  {!product.available
                    ? "Temporarily unavailable"
                    : product.trackInventory && product.stockQuantity === 0
                      ? "Sold out"
                      : product.trackInventory
                        ? `${product.stockQuantity} in stock`
                        : "Available · stock not tracked"}
                </span>
                <h3>{product.name}</h3>
                {isProductDiscountActive(product, now) ? (
                  <div className="managed-product-price">
                    <strong>{discountedProductPrice(product).toFixed(2)}</strong>
                    <del>{product.price.toFixed(2)}</del>
                    <span>{product.discountPercent}% off</span>
                  </div>
                ) : <strong>{product.price.toFixed(2)}</strong>}
                {product.discountType === "timed" && product.discountEndsAt && (
                  <DiscountCountdown endsAt={product.discountEndsAt} now={now} />
                )}
                {product.description && <p>{product.description}</p>}
                <div className="product-card-actions">
                  <button className="button button-outline" type="button" onClick={() => {
                    setDiscountType(isProductDiscountActive(product, now) ? product.discountType : "none");
                    setTrackInventory(product.trackInventory === true);
                    setEditingProduct(product);
                  }}>Edit</button>
                  <button className="button button-outline" type="button" onClick={() => updateAvailability(product)}>
                    Mark {product.available ? "unavailable" : "available"}
                  </button>
                  <button className="product-delete-button" type="button" onClick={() => removeProduct(product)}>Delete</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BusinessProductCatalog({ businessId, customerId, business, onCartDealPlaced }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({});
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [error, setError] = useState("");
  const [cartError, setCartError] = useState("");
  const [placingDeal, setPlacingDeal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const cartKey = `commonground-cart-${customerId}-${businessId}`;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    request(`/api/neighborhood/businesses/${encodeURIComponent(businessId)}/products`)
      .then(({ products: loaded }) => {
        if (active) setProducts(loaded);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    try {
      const savedCart = window.localStorage.getItem(cartKey);
      if (savedCart) {
        const parsedCart = JSON.parse(savedCart);
        if (!parsedCart || typeof parsedCart !== "object" || Array.isArray(parsedCart)) {
          throw new Error("Saved cart data is invalid.");
        }
        if (active) setCart(parsedCart);
      }
    } catch (storageError) {
      if (active) setCartError(`Could not load your saved cart: ${storageError.message}`);
    } finally {
      if (active) setCartLoaded(true);
    }
    return () => {
      active = false;
    };
  }, [businessId, cartKey]);

  useEffect(() => {
    if (!cartLoaded) return;
    try {
      window.localStorage.setItem(cartKey, JSON.stringify(cart));
      setCartError("");
    } catch (storageError) {
      setCartError(`Could not save your cart: ${storageError.message}`);
    }
  }, [cart, cartKey, cartLoaded]);

  function changeQuantity(product, change) {
    setCart((current) => {
      const nextQuantity = (Number(current[product.id]) || 0) + change;
      if (nextQuantity <= 0) {
        const next = { ...current };
        delete next[product.id];
        return next;
      }
      if (
        change > 0 &&
        (
          !product.available ||
          nextQuantity > 99 ||
          (product.trackInventory === true && nextQuantity > product.stockQuantity)
        )
      ) return current;
      return { ...current, [product.id]: nextQuantity };
    });
  }

  async function placeCartDeal() {
    if (placingDeal || cartItems.length === 0) return;
    setPlacingDeal(true);
    setCartError("");
    try {
      const { deal } = await request(
        `/api/neighborhood/businesses/${encodeURIComponent(businessId)}/cart-deals`,
        {
          method: "POST",
          body: JSON.stringify({
            items: cartItems.map(({ productId, quantity }) => ({ productId, quantity })),
          }),
        },
      );
      let cartClearWarning = "";
      try {
        window.localStorage.removeItem(cartKey);
      } catch (storageError) {
        cartClearWarning = `The deal was placed, but your saved cart could not be cleared: ${storageError.message}`;
      }
      setCart({});
      onCartDealPlaced(deal, business, cartClearWarning);
    } catch (placeError) {
      setCartError(placeError.message);
    } finally {
      setPlacingDeal(false);
    }
  }

  const cartItems = Object.entries(cart)
    .map(([productId, quantity]) => ({
      product: products.find((item) => item.id === productId),
      quantity: Number(quantity),
      productId,
    }))
    .filter(({ quantity }) => Number.isInteger(quantity) && quantity > 0);
  const cartTotal = cartItems.reduce(
    (total, { product, quantity }) => total + (product
      ? (isProductDiscountActive(product, now) ? discountedProductPrice(product) : product.price) * quantity
      : 0),
    0,
  );

  return (
    <section className="business-product-catalog" aria-label="Business products">
      <header className="business-products-heading">
        <div>
          <p className="eyebrow">Shop local</p>
          <h4>Products</h4>
        </div>
        <span className="people-count">{products.length}</span>
      </header>
      {error && <p className="chat-error" role="alert">{error}</p>}
      {loading ? (
        <p className="product-catalog-empty">Loading products…</p>
      ) : products.length === 0 ? (
        <p className="product-catalog-empty">No products listed yet.</p>
      ) : (
        <div className="product-catalog-grid">
          {products.map((product) => (
            <article className={`product-catalog-card${product.available ? "" : " unavailable"}`} key={product.id}>
              <button
                className="product-catalog-info"
                type="button"
                aria-expanded={expandedProductId === product.id}
                onClick={() => setExpandedProductId((current) => current === product.id ? null : product.id)}
              >
                <img src={product.photoUrl} alt={product.name} loading="lazy" />
                <span className="product-catalog-name">{product.name}</span>
                {isProductDiscountActive(product, now) ? (
                  <span className="product-discount-prices">
                    <strong>₹{discountedProductPrice(product).toFixed(2)}</strong>
                    <del>₹{Number(product.price).toFixed(2)}</del>
                    <span className="product-discount-badge">{product.discountPercent}% off</span>
                  </span>
                ) : <strong>₹{Number(product.price).toFixed(2)}</strong>}
                {product.discountType === "timed" && product.discountEndsAt && (
                  <DiscountCountdown endsAt={product.discountEndsAt} now={now} />
                )}
                {product.description && (
                  <span className={`product-catalog-description${expandedProductId === product.id ? " expanded" : ""}`}>
                    {product.description}
                  </span>
                )}
                {product.description && (
                  <span className="product-details-hint">
                    {expandedProductId === product.id ? "Show less" : "View full description"}
                  </span>
                )}
              </button>
              <button
                className="button button-outline product-add-button"
                type="button"
                disabled={
                  !product.available ||
                  (product.trackInventory === true && product.stockQuantity <= 0) ||
                  (product.trackInventory === true && (Number(cart[product.id]) || 0) >= product.stockQuantity)
                }
                onClick={() => changeQuantity(product, 1)}
              >
                {!product.available
                  ? "Temporarily unavailable"
                  : product.trackInventory === true && product.stockQuantity <= 0
                    ? "Sold out"
                    : product.trackInventory === true && (Number(cart[product.id]) || 0) >= product.stockQuantity
                      ? "Stock limit reached"
                      : "Add to cart"}
              </button>
              {product.trackInventory === true && product.stockQuantity > 0 && (
                <span className="product-stock-note">
                  {product.stockQuantity} {product.stockQuantity === 1 ? "item" : "items"} remaining
                </span>
              )}
            </article>
          ))}
        </div>
      )}
      <section className="business-cart" aria-label="Shopping cart">
        <header>
          <h5>Your cart</h5>
          <span>{cartItems.reduce((count, item) => count + item.quantity, 0)} items</span>
        </header>
        {cartItems.length === 0 ? (
          <p className="product-catalog-empty">Your cart is empty.</p>
        ) : (
          <>
            <ul>
              {cartItems.map(({ product, quantity, productId }) => (
                <li key={productId}>
                  <span>
                    {product?.name || "Product no longer available"}
                    {product && (
                      <span className="cart-item-price">
                        {" "}· ₹{(isProductDiscountActive(product, now) ? discountedProductPrice(product) : product.price).toFixed(2)} each
                      </span>
                    )}
                  </span>
                  <div className="cart-item-controls">
                    <button type="button" aria-label="Decrease quantity" onClick={() => changeQuantity({ id: productId, available: true }, -1)}>−</button>
                    <span>{quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      disabled={!product?.available || quantity >= 99}
                      onClick={() => product && changeQuantity(product, 1)}
                    >+</button>
                    <button className="cart-remove-button" type="button" onClick={() => setCart((current) => {
                      const next = { ...current };
                      delete next[productId];
                      return next;
                    })}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
            <strong className="cart-total">Estimated total: ₹{cartTotal.toFixed(2)}</strong>
            <p className="field-hint">Placing this deal automatically accepts the item and price summary. You can continue in the deal chat.</p>
            <button
              className="button button-primary cart-place-deal"
              type="button"
              disabled={placingDeal || cartItems.length === 0 || cartItems.some(({ product, quantity }) => (
                !product ||
                !product.available ||
                (product.trackInventory === true && quantity > product.stockQuantity)
              ))}
              onClick={placeCartDeal}
            >
              {placingDeal ? "Placing deal…" : "Place a deal"}
            </button>
          </>
        )}
        {cartError && <p className="chat-error" role="alert">{cartError}</p>}
      </section>
    </section>
  );
}

function BusinessDashboard({ business, onSignOut, onBusinessUpdated, notice }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [activeView, setActiveView] = useState("profile");
  const [activeDealTarget, setActiveDealTarget] = useState(null);
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
          <button className={`nav-button${activeView === "products" ? " active" : ""}`} type="button" onClick={() => setActiveView("products")}>Products</button>
          <button className={`nav-button${activeView === "inbox" ? " active" : ""}`} type="button" onClick={() => setActiveView("inbox")}>Business chats</button>
          <button className={`nav-button${activeView === "activeDeals" ? " active" : ""}`} type="button" onClick={() => setActiveView("activeDeals")}>Active deals</button>
          <button className={`nav-button${activeView === "reviews" ? " active" : ""}`} type="button" onClick={() => setActiveView("reviews")}>Reviews</button>
        </nav>
        <div className="business-topbar-actions">
          <span>Business account</span>
          <button className="button button-outline" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      <section className="business-dashboard-heading">
        <p className="eyebrow">{activeView === "inbox" ? "Customer support" : activeView === "activeDeals" ? "Agreements" : activeView === "reviews" ? "Customer feedback" : activeView === "products" ? "Inventory" : "Business profile"}</p>
        <h1>{business.businessName}</h1>
        <p>{business.category} · {business.pincode}</p>
      </section>
      {activeView === "products" ? (
        <BusinessProductsManager key={business.id} />
      ) : activeView === "inbox" ? <BusinessInbox business={business} initialDealTarget={activeDealTarget} /> : activeView === "activeDeals" ? (
        <ActiveDealsView
          accountType="business"
          accountId={business.id}
          onOpenDeal={(deal) => {
            setActiveDealTarget({ customer: deal.customer, dealId: deal.id });
            setActiveView("inbox");
          }}
        />
      ) : activeView === "reviews" ? (
        <BusinessReviews
          accountType="business"
          businessId={business.id}
          businessName={business.businessName}
        />
      ) : (
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

function RatingStars({ rating, label }) {
  const roundedRating = Math.round(rating || 0);
  return (
    <span className="rating-stars" role="img" aria-label={label || `${rating || 0} out of 5 stars`}>
      {"★".repeat(roundedRating)}{"☆".repeat(5 - roundedRating)}
    </span>
  );
}

function ServiceReviews({ provider, serviceName, serviceLabel }) {
  const [expanded, setExpanded] = useState(false);
  const summary = provider.serviceRatingSummaries?.[serviceName] || { averageRating: 0, reviewCount: 0 };
  const [currentSummary, setCurrentSummary] = useState(summary);
  useEffect(() => setCurrentSummary(summary), [provider.serviceRatingSummaries, serviceName]);
  return (
    <div className="service-reviews">
      <div className="business-directory-rating">
        <RatingStars rating={currentSummary.averageRating} label={`${serviceLabel} average rating ${currentSummary.averageRating} out of 5`} />
        <strong>{Number(currentSummary.averageRating || 0).toFixed(1)}</strong>
        <span>{currentSummary.reviewCount || 0} {currentSummary.reviewCount === 1 ? "review" : "reviews"}</span>
      </div>
      <button
        className="business-reviews-toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "Hide service reviews" : `Read ${serviceLabel} reviews & rate`}
      </button>
      {expanded && (
        <ServiceReviewForm
          provider={provider}
          serviceName={serviceName}
          serviceLabel={serviceLabel}
          onSummaryChange={setCurrentSummary}
        />
      )}
    </div>
  );
}

function ServiceReviewForm({ provider, serviceName, serviceLabel, onSummaryChange }) {
  const reviewsUrl = `/api/service-providers/providers/${encodeURIComponent(provider.id)}/reviews?serviceName=${encodeURIComponent(serviceName)}`;
  const [reviews, setReviews] = useState([]);
  const [averageRating, setAverageRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [distribution, setDistribution] = useState({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [canReview, setCanReview] = useState(false);
  const [myReview, setMyReview] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    request(reviewsUrl)
      .then((result) => {
        if (!active) return;
        setReviews(result.reviews);
        setAverageRating(result.averageRating);
        setReviewCount(result.reviewCount);
        setDistribution(result.distribution);
        setCanReview(Boolean(result.canReview));
        setMyReview(result.myReview);
        onSummaryChange({ averageRating: result.averageRating, reviewCount: result.reviewCount });
        setRating(result.myReview?.rating || 0);
        setComment(result.myReview?.comment || "");
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reviewsUrl]);

  async function submitReview(event) {
    event.preventDefault();
    if (!rating || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await request(`/api/service-providers/providers/${encodeURIComponent(provider.id)}/reviews`, {
        method: "POST",
        body: JSON.stringify({ serviceName, rating, comment }),
      });
      setReviews(result.reviews);
      setAverageRating(result.averageRating);
      setReviewCount(result.reviewCount);
      setDistribution(result.distribution);
      setCanReview(Boolean(result.canReview));
      setMyReview(result.myReview);
      onSummaryChange({ averageRating: result.averageRating, reviewCount: result.reviewCount });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  const visibleReviews = filter === "all" ? reviews : reviews.filter((review) => review.rating === Number(filter));
  return (
    <section className="business-reviews service-review-details" aria-label={`${serviceLabel} reviews for ${provider.name}`}>
      <header className="reviews-summary">
        <div><p className="eyebrow">Service reviews</p><h4>{serviceLabel} · {provider.name}</h4></div>
        <div className="reviews-average">
          <RatingStars rating={averageRating} label={`${serviceLabel} average rating ${averageRating} out of 5`} />
          <strong>{averageRating.toFixed(1)}</strong>
          <span>{reviewCount} {reviewCount === 1 ? "review" : "reviews"}</span>
        </div>
      </header>
      {error && <p className="chat-error" role="alert">{error}</p>}
      {canReview && (
        <form className="business-review-form" onSubmit={submitReview}>
          <h4>{myReview ? "Update your review" : `Review ${serviceLabel}`}</h4>
          <fieldset>
            <legend>Choose a star rating</legend>
            <div className="review-star-picker">
              {[1, 2, 3, 4, 5].map((stars) => (
                <button type="button" key={stars} className={stars <= rating ? "selected" : ""} aria-label={`${stars} ${stars === 1 ? "star" : "stars"}`} aria-pressed={rating === stars} onClick={() => setRating(stars)}>
                  {stars <= rating ? "★" : "☆"}
                </button>
              ))}
            </div>
          </fieldset>
          <label htmlFor={`service-review-comment-${provider.id}-${serviceName}`}>Comment <span className="optional">Optional</span></label>
          <textarea
            id={`service-review-comment-${provider.id}-${serviceName}`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1500}
            rows={3}
            placeholder={`Share your experience with ${serviceLabel.toLocaleLowerCase()}…`}
          />
          <button className="button button-primary" type="submit" disabled={!rating || submitting}>
            {submitting ? "Saving…" : myReview ? "Update review" : "Post review"}
          </button>
        </form>
      )}
      {!canReview && <p className="review-eligibility-note">Review this service after you have an accepted or fulfilled deal with this provider for this service.</p>}
      <div className="review-filter" role="group" aria-label={`Filter ${serviceLabel} reviews by rating`}>
        <button className={filter === "all" ? "active" : ""} type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <span>{reviewCount}</span></button>
        {[5, 4, 3, 2, 1].map((stars) => (
          <button className={filter === String(stars) ? "active" : ""} type="button" key={stars} aria-pressed={filter === String(stars)} onClick={() => setFilter(String(stars))}>
            {stars} ★ <span>{distribution[stars]}</span>
          </button>
        ))}
      </div>
      {loading ? <p className="review-empty">Loading reviews…</p> : visibleReviews.length === 0 ? (
        <p className="review-empty">{reviews.length ? `No ${filter}-star reviews yet.` : "No reviews yet. Verified customer reviews will appear here."}</p>
      ) : (
        <div className="review-list">
          {visibleReviews.map((review) => (
            <article className="business-review" key={review.id}>
              <header><strong>{review.reviewerName}</strong><time dateTime={review.updatedAt}>{new Date(review.updatedAt).toLocaleDateString()}</time></header>
              <RatingStars rating={review.rating} label={`${review.rating} out of 5 stars`} />
              {review.comment && <p>{review.comment}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ServiceProviderReviews({ serviceProvider }) {
  const [serviceReviews, setServiceReviews] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    request("/api/service-providers/reviews")
      .then(({ serviceReviews: loaded }) => {
        if (active) setServiceReviews(loaded);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [serviceProvider.id, serviceProvider.updatedAt]);

  return (
    <section className="business-reviews business-owner-reviews" aria-label="Customer reviews for your services">
      <header className="reviews-summary">
        <div><p className="eyebrow">Customer feedback</p><h3>Reviews by service</h3></div>
      </header>
      {error && <p className="chat-error" role="alert">{error}</p>}
      {loading ? <p className="review-empty">Loading service reviews…</p> : (
        <div className="service-review-groups">
          {serviceReviews.map((service) => (
            <section className="service-review-group" key={service.serviceName}>
              <header className="reviews-summary">
                <div><h4>{service.serviceName === "Other" ? serviceProvider.otherService || "Other" : service.serviceName}</h4></div>
                <div className="reviews-average">
                  <RatingStars rating={service.averageRating} label={`${service.serviceName} average rating ${service.averageRating} out of 5`} />
                  <strong>{Number(service.averageRating || 0).toFixed(1)}</strong>
                  <span>{service.reviewCount} {service.reviewCount === 1 ? "review" : "reviews"}</span>
                </div>
              </header>
              <div className="review-distribution" aria-label={`${service.serviceName} ratings breakdown`}>
                {[5, 4, 3, 2, 1].map((stars) => (
                  <div className="review-distribution-row" key={stars}>
                    <span>{stars} stars</span>
                    <span className="review-distribution-track"><span style={{ width: `${service.reviewCount ? (service.distribution[stars] / service.reviewCount) * 100 : 0}%` }} /></span>
                    <strong>{service.distribution[stars]}</strong>
                  </div>
                ))}
              </div>
              {service.reviews.length === 0 ? <p className="review-empty">No reviews for this service yet.</p> : (
                <div className="review-list">
                  {service.reviews.map((review) => (
                    <article className="business-review" key={review.id}>
                      <header><strong>{review.reviewerName}</strong><time dateTime={review.updatedAt}>{new Date(review.updatedAt).toLocaleDateString()}</time></header>
                      <RatingStars rating={review.rating} label={`${review.rating} out of 5 stars`} />
                      {review.comment && <p>{review.comment}</p>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function BusinessReviews({ businessId, businessName, accountType = "user", onSummaryChange }) {
  const [reviews, setReviews] = useState([]);
  const [averageRating, setAverageRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [distribution, setDistribution] = useState({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [canReview, setCanReview] = useState(false);
  const [myReview, setMyReview] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const isBusiness = accountType === "business";
  const reviewsUrl = isBusiness
    ? "/api/business/reviews"
    : `/api/neighborhood/businesses/${encodeURIComponent(businessId)}/reviews`;

  useEffect(() => {
    let active = true;
    request(reviewsUrl)
      .then((result) => {
        if (!active) return;
        setReviews(result.reviews);
        setAverageRating(result.averageRating);
        setReviewCount(result.reviewCount);
        setDistribution(result.distribution);
        setCanReview(Boolean(result.canReview));
        setMyReview(result.myReview);
        onSummaryChange?.({
          averageRating: result.averageRating,
          reviewCount: result.reviewCount,
          distribution: result.distribution,
        });
        setRating(result.myReview?.rating || 0);
        setComment(result.myReview?.comment || "");
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reviewsUrl]);

  async function submitReview(event) {
    event.preventDefault();
    if (!rating || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await request(reviewsUrl, {
        method: "POST",
        body: JSON.stringify({ rating, comment }),
      });
      setReviews(result.reviews);
      setAverageRating(result.averageRating);
      setReviewCount(result.reviewCount);
      setDistribution(result.distribution);
      setCanReview(Boolean(result.canReview));
      setMyReview(result.myReview);
      onSummaryChange?.({
        averageRating: result.averageRating,
        reviewCount: result.reviewCount,
        distribution: result.distribution,
      });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  const visibleReviews = filter === "all"
    ? reviews
    : reviews.filter((review) => review.rating === Number(filter));

  return (
    <section className={`business-reviews${isBusiness ? " business-owner-reviews" : ""}`} aria-label={`${businessName} reviews`}>
      <header className="reviews-summary">
        <div>
          <p className="eyebrow">{isBusiness ? "Customer feedback" : "Customer reviews"}</p>
          <h3>{isBusiness ? "Reviews for your business" : `Reviews for ${businessName}`}</h3>
        </div>
        <div className="reviews-average">
          <RatingStars rating={averageRating} label={`Average rating ${averageRating} out of 5`} />
          <strong>{averageRating.toFixed(1)}</strong>
          <span>{reviewCount} {reviewCount === 1 ? "review" : "reviews"}</span>
        </div>
      </header>
      {error && <p className="chat-error" role="alert">{error}</p>}
      {isBusiness && (
        <div className="review-distribution" aria-label="Ratings breakdown">
          {[5, 4, 3, 2, 1].map((stars) => (
            <div className="review-distribution-row" key={stars}>
              <span>{stars} stars</span>
              <span className="review-distribution-track">
                <span style={{ width: `${reviewCount ? (distribution[stars] / reviewCount) * 100 : 0}%` }} />
              </span>
              <strong>{distribution[stars]}</strong>
            </div>
          ))}
        </div>
      )}
      {!isBusiness && canReview && (
        <form className="business-review-form" onSubmit={submitReview}>
          <h4>{myReview ? "Update your review" : "Share your experience"}</h4>
          <fieldset>
            <legend>Choose a star rating</legend>
            <div className="review-star-picker">
              {[1, 2, 3, 4, 5].map((stars) => (
                <button
                  type="button"
                  key={stars}
                  className={stars <= rating ? "selected" : ""}
                  aria-label={`${stars} ${stars === 1 ? "star" : "stars"}`}
                  aria-pressed={rating === stars}
                  onClick={() => setRating(stars)}
                >
                  {stars <= rating ? "★" : "☆"}
                </button>
              ))}
            </div>
          </fieldset>
          <label htmlFor={`business-review-comment-${businessId}`}>Comment <span className="optional">Optional</span></label>
          <textarea
            id={`business-review-comment-${businessId}`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1500}
            rows={3}
            placeholder="Tell others about your experience with this business…"
          />
          <button className="button button-primary" type="submit" disabled={!rating || submitting}>
            {submitting ? "Saving…" : myReview ? "Update review" : "Post review"}
          </button>
        </form>
      )}
      {!isBusiness && !canReview && (
        <p className="review-eligibility-note">
          Reviews are available to customers after a deal has been accepted.
        </p>
      )}
      <div className="review-filter" role="group" aria-label="Filter reviews by rating">
        <button className={filter === "all" ? "active" : ""} type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All <span>{reviewCount}</span>
        </button>
        {[5, 4, 3, 2, 1].map((stars) => (
          <button
            className={filter === String(stars) ? "active" : ""}
            type="button"
            key={stars}
            aria-pressed={filter === String(stars)}
            onClick={() => setFilter(String(stars))}
          >
            {stars} ★ <span>{distribution[stars]}</span>
          </button>
        ))}
      </div>
      {loading ? (
        <p className="review-empty">Loading reviews…</p>
      ) : visibleReviews.length === 0 ? (
        <p className="review-empty">
          {reviews.length ? `No ${filter}-star reviews yet.` : "No reviews yet. Verified customer reviews will appear here."}
        </p>
      ) : (
        <div className="review-list">
          {visibleReviews.map((review) => (
            <article className="business-review" key={review.id}>
              <header>
                <strong>{review.reviewerName}</strong>
                <time dateTime={review.updatedAt}>{new Date(review.updatedAt).toLocaleDateString()}</time>
              </header>
              <RatingStars rating={review.rating} label={`${review.rating} out of 5 stars`} />
              {review.comment && <p>{review.comment}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BusinessDirectoryView({
  businesses,
  customerId,
  loading,
  error,
  search,
  onSearch,
  onOpenChat,
  onCartDealPlaced,
  onBusinessRatingUpdated,
}) {
  const [expandedBusinessId, setExpandedBusinessId] = useState(null);
  const [productsBusinessId, setProductsBusinessId] = useState(null);
  return (
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
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            aria-label="Search businesses by name, category, or service"
          />
        </label>
      </header>
      {error && <p className="chat-error" role="alert">{error}</p>}
      {loading ? (
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
                <div className="business-directory-rating">
                  <RatingStars rating={business.averageRating} label={`Average rating ${business.averageRating} out of 5`} />
                  <strong>{Number(business.averageRating || 0).toFixed(1)}</strong>
                  <span>{business.reviewCount || 0} {business.reviewCount === 1 ? "review" : "reviews"}</span>
                </div>
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
                  onClick={() => onOpenChat(business)}
                >
                  Message business
                </button>
                <button
                  className="business-reviews-toggle"
                  type="button"
                  aria-expanded={productsBusinessId === business.id}
                  onClick={() => setProductsBusinessId((current) => current === business.id ? null : business.id)}
                >
                  {productsBusinessId === business.id ? "Hide products" : "View products & cart"}
                </button>
                {productsBusinessId === business.id && (
                  <BusinessProductCatalog
                    key={`${customerId}-${business.id}`}
                    businessId={business.id}
                    customerId={customerId}
                    business={business}
                    onCartDealPlaced={onCartDealPlaced}
                  />
                )}
                <button
                  className="business-reviews-toggle"
                  type="button"
                  aria-expanded={expandedBusinessId === business.id}
                  onClick={() => setExpandedBusinessId((current) => current === business.id ? null : business.id)}
                >
                  {expandedBusinessId === business.id ? "Hide reviews" : "Read reviews & rate"}
                </button>
                {expandedBusinessId === business.id && (
                  <BusinessReviews
                    businessId={business.id}
                    businessName={business.businessName}
                    onSummaryChange={(summary) => onBusinessRatingUpdated(business.id, summary)}
                  />
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BusinessChatsView({
  conversations,
  userId,
  selectedBusiness,
  messages,
  draft,
  error,
  sending,
  loadingMessages,
  messagesEndRef,
  onSelectBusiness,
  onBrowseBusinesses,
  onDraftChange,
  onSendMessage,
  onCreateDeal,
}) {
  const [mode, setMode] = useState("messages");
  async function createDealFromMessage(proposal) {
    await onCreateDeal(proposal);
    setMode("deals");
  }

  return (
    <section className="community-layout business-chats-layout" aria-label="Business chats">
      <aside className="people-panel">
        <div className="people-panel-heading">
          <div><h2>Business chats</h2><p>{conversations.length} conversations</p></div>
          <span className="people-count">{conversations.length}</span>
        </div>
        <div className="people-list">
          {conversations.length === 0 ? (
            <div className="people-empty">
              <strong>No business chats yet.</strong>
              <span>Discover a business nearby to start a conversation.</span>
              <button className="button button-outline" type="button" onClick={onBrowseBusinesses}>Browse businesses</button>
            </div>
          ) : conversations.map(({ business, lastMessage }) => (
            <button
              className={`person-row${selectedBusiness?.id === business.id ? " selected" : ""}`}
              key={business.id}
              type="button"
              onClick={() => onSelectBusiness(business)}
            >
              <span className="avatar person-avatar">{business.businessName.charAt(0).toUpperCase()}</span>
              <span className="person-summary">
                <span className="person-name">{business.businessName}</span>
                <span className="person-detail">{lastMessage.content}</span>
              </span>
            </button>
          ))}
          {selectedBusiness && !conversations.some((item) => item.business.id === selectedBusiness.id) && (
            <button className="person-row selected" type="button" onClick={() => onSelectBusiness(selectedBusiness)}>
              <span className="avatar person-avatar">{selectedBusiness.businessName.charAt(0).toUpperCase()}</span>
              <span className="person-summary">
                <span className="person-name">{selectedBusiness.businessName}</span>
                <span className="person-detail">New conversation</span>
              </span>
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
            <div className="business-chat-mode-switch" role="tablist" aria-label="Conversation type">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "messages"}
                className={mode === "messages" ? "active" : ""}
                onClick={() => setMode("messages")}
              >
                Messages
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "deals"}
                className={mode === "deals" ? "active" : ""}
                onClick={() => setMode("deals")}
              >
                Deals
              </button>
            </div>
            {mode === "deals" ? (
              <DealCenter
                accountType="user"
                userId={userId}
                businessId={selectedBusiness.id}
                businessName={selectedBusiness.businessName}
              />
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
                  {selectedBusiness.photos.map((photo) => (
                    <img key={photo} src={photo} alt={`${selectedBusiness.businessName} showcase`} />
                  ))}
                </div>
              )}
            </div>
            <div className="messages-area" aria-live="polite" aria-label="Business messages">
              {loadingMessages && messages.length === 0 ? (
                <p className="messages-loading">Opening your business chat…</p>
              ) : messages.map((message) => {
                const ownMessage = message.senderType === "user";
                return (
                  <DealMessageContext
                    className={ownMessage ? "own-message" : ""}
                    key={message.id}
                    message={message}
                    onCreateDeal={createDealFromMessage}
                  >
                    <div className="message-content">
                      <span className="message-sender">{ownMessage ? "You" : selectedBusiness.businessName}</span>
                      <p>{message.content}</p>
                      <time dateTime={message.createdAt}>
                        {new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </time>
                    </div>
                  </DealMessageContext>
                );
              })}
              {!loadingMessages && messages.length === 0 && (
                <div className="conversation-start">
                  <span className="conversation-start-mark">c.</span>
                  <strong>Start a business conversation.</strong>
                  <span>Ask about products, services, or opening hours.</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form className="message-composer" onSubmit={onSendMessage}>
              {error && <p className="chat-error" role="alert">{error}</p>}
              <label className="sr-only" htmlFor="business-chat-draft">Write a business message</label>
              <textarea
                id="business-chat-draft"
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                maxLength={2000}
                placeholder={`Message ${selectedBusiness.businessName}…`}
                rows="2"
                disabled={sending}
              />
              <button className="button button-primary" type="submit" disabled={!draft.trim() || sending}>
                {sending ? "Sending…" : "Send message"} <span aria-hidden="true">↗</span>
              </button>
            </form>
              </>
            )}
          </>
        )}
      </section>
    </section>
  );
}

function DealCenter({
  accountType,
  userId,
  businessId,
  businessName,
  focusedDealId,
  serviceName = "",
  serviceDisplayName = serviceName,
  otherServiceDisplayName = "Other",
}) {
  const [deals, setDeals] = useState([]);
  const [filter, setFilter] = useState("all");
  const [proposal, setProposal] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalSubmitting, setProposalSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const focusedDealRef = useRef(null);

  const serviceDeal = accountType === "serviceCustomer" || accountType === "serviceProvider";
  const listUrl = accountType === "user"
    ? `/api/neighborhood/businesses/${encodeURIComponent(businessId)}/deals`
    : accountType === "serviceCustomer"
      ? `/api/service-providers/providers/${encodeURIComponent(businessId)}/deals`
      : accountType === "serviceProvider"
        ? `/api/service-providers/conversations/${encodeURIComponent(userId)}/deals`
        : `/api/business/conversations/${encodeURIComponent(userId)}/deals`;
  const dealsUrl = accountType === "user"
    ? "/api/neighborhood/deals"
    : accountType === "serviceCustomer"
      ? "/api/service-providers/deals"
      : accountType === "serviceProvider"
        ? "/api/service-providers/provider-deals"
        : "/api/business/deals";
  const creatorType = accountType === "serviceCustomer" ? "user" : accountType;
  const otherPartyName = accountType === "serviceCustomer"
    ? businessName
    : accountType === "serviceProvider"
      ? businessName
      : accountType === "user" ? businessName : "the customer";

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setDeals([]);
    request(listUrl)
      .then(({ deals: loaded }) => {
        if (active) {
          setDeals(loaded);
          setError("");
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const socket = io({ withCredentials: true });
    const handleDealUpdate = (updatedDeal) => {
      if (serviceDeal
        ? updatedDeal.userId !== userId || updatedDeal.serviceProviderId !== businessId
        : updatedDeal.userId !== userId || updatedDeal.businessId !== businessId) return;
      setDeals((current) => [
        updatedDeal,
        ...current.filter((deal) => deal.id !== updatedDeal.id),
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    };
    socket.on(serviceDeal ? "service-deal:update" : "business-deal:update", handleDealUpdate);
    socket.on("connect_error", () => {
      setError("Live deal updates are reconnecting. Refresh to check the latest status.");
    });
    return () => {
      active = false;
      socket.disconnect();
    };
  }, [listUrl, userId, businessId]);

  useEffect(() => {
    if (!loading) focusedDealRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [loading, focusedDealId]);

  async function createDeal(event) {
    event.preventDefault();
    const text = proposal.trim();
    if (!text || proposalSubmitting) return;
    setProposalSubmitting(true);
    setError("");
    try {
      const { deal } = await request(listUrl, {
        method: "POST",
        body: JSON.stringify(serviceDeal ? { proposal: text, serviceName } : { proposal: text }),
      });
      setDeals((current) => [deal, ...current.filter((item) => item.id !== deal.id)]);
      setProposal("");
      setProposalOpen(false);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setProposalSubmitting(false);
    }
  }

  async function updateStatus(dealId, action) {
    setError("");
    try {
      const { deal } = await request(`${dealsUrl}/${encodeURIComponent(dealId)}/status`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setDeals((current) => current.map((item) => item.id === deal.id ? deal : item));
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  async function sendDealMessage(event, dealId) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError("");
    try {
      const { deal } = await request(`${dealsUrl}/${encodeURIComponent(dealId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setDeals((current) => current.map((item) => item.id === deal.id ? deal : item));
      setDraft("");
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  const visibleDeals = deals.filter((deal) => {
    if (filter === "fulfilled") return deal.status === "fulfilled";
    if (filter === "active") return deal.status === "pending" || deal.status === "accepted";
    return true;
  });

  function statusLabel(status, autoAccepted) {
    return {
      pending: "Awaiting response",
      accepted: autoAccepted ? "Order · Auto-accepted" : "Accepted · Active",
      declined: "Not proceeding",
      fulfilled: "Fulfilled",
    }[status] || "Status unavailable";
  }

  return (
    <div className="deal-center">
      <header className="deal-center-heading">
        <div>
          <p className="eyebrow">Agreements</p>
          <h2>Deals with {otherPartyName}</h2>
        </div>
        <button className="button button-primary deal-create-toggle" type="button" disabled={serviceDeal && !serviceName} onClick={() => setProposalOpen((current) => !current)}>
          {proposalOpen ? "Cancel proposal" : "Propose a deal"}
        </button>
      </header>
      {serviceDeal && <p className="deal-service-context">Service: <strong>{serviceDisplayName || "Choose a service above to propose a deal."}</strong></p>}
      {proposalOpen && (
        <form className="deal-proposal-form" onSubmit={createDeal}>
          <label htmlFor={`deal-proposal-${businessId}`}>Describe the proposed deal</label>
          <textarea
            id={`deal-proposal-${businessId}`}
            value={proposal}
            onChange={(event) => setProposal(event.target.value)}
            maxLength={2000}
            rows="3"
            placeholder="Describe the product or service, agreed price, and any important terms…"
            required
          />
          <div className="deal-form-footer">
            <span>Both parties can review and respond before it becomes active.</span>
            <button className="button button-primary" type="submit" disabled={!proposal.trim() || proposalSubmitting}>
              {proposalSubmitting ? "Sending…" : "Send proposal"}
            </button>
          </div>
        </form>
      )}
      <div className="deal-filters" role="group" aria-label="Filter deals">
        {[
          ["all", "All"],
          ["active", "Active"],
          ["fulfilled", "Fulfilled"],
        ].map(([value, label]) => (
          <button
            className={filter === value ? "active" : ""}
            type="button"
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="chat-error" role="alert">{error}</p>}
      {loading ? (
        <p className="deal-empty">Loading deals…</p>
      ) : visibleDeals.length === 0 ? (
        <div className="deal-empty">
          <strong>{filter === "all" ? "No deal proposals yet." : `No ${filter} deals.`}</strong>
          <span>Use “Propose a deal” to write down the terms for both parties to review.</span>
        </div>
      ) : (
        <div className="deal-list">
          {visibleDeals.map((deal) => {
            const isCreator = deal.creatorType === creatorType;
            const canRespond = deal.status === "pending" && !isCreator;
            return (
              <article
                className={`deal-card deal-${deal.status}${deal.id === focusedDealId ? " deal-card-focused" : ""}`}
                key={deal.id}
                ref={deal.id === focusedDealId ? focusedDealRef : undefined}
              >
                <header className="deal-card-heading">
                  <span className="deal-status">{statusLabel(deal.status, deal.autoAccepted)}</span>
                  <time dateTime={deal.updatedAt}>{new Date(deal.updatedAt).toLocaleDateString()}</time>
                </header>
                <p className="deal-proposal">{deal.proposal}</p>
                {serviceDeal && deal.serviceName && <span className="service-message-tag deal-service-tag">{deal.serviceName === "Other" ? otherServiceDisplayName : deal.serviceName}</span>}
                <span className="deal-created-by">
                  Proposed by {isCreator ? "you" : otherPartyName}
                </span>
                <ProductOrderDetails deal={deal} />
                {canRespond && (
                  <div className="deal-actions">
                    <button className="button button-primary" type="button" onClick={() => updateStatus(deal.id, "accept")}>Accept proposal</button>
                    <button className="button button-outline" type="button" onClick={() => updateStatus(deal.id, "pass")}>Not at this time</button>
                  </div>
                )}
                {(deal.status === "accepted" || deal.status === "fulfilled") && (
                  <>
                    <div className="deal-thread">
                      <h3>Deal chat</h3>
                      {(Array.isArray(deal.messages) ? deal.messages : []).map((message) => {
                        const ownMessage = message.senderType === creatorType;
                        return (
                          <div className={`deal-message${ownMessage ? " own" : ""}`} key={message.id}>
                            <span>{ownMessage ? "You" : accountType === "user" ? businessName : accountType === "serviceCustomer" ? businessName : "Customer"}</span>
                            {serviceDeal && <span className="service-message-tag">{deal.serviceName === "Other" ? otherServiceDisplayName : deal.serviceName || "Service deal"}</span>}
                            <p>{message.content}</p>
                            <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
                          </div>
                        );
                      })}
                      {deal.status === "accepted" && (
                        <form className="deal-message-form" onSubmit={(event) => sendDealMessage(event, deal.id)}>
                          <textarea
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            maxLength={2000}
                            rows="2"
                            placeholder="Discuss details for this deal…"
                            aria-label="Write a deal chat message"
                          />
                          <button className="button button-primary" type="submit" disabled={!draft.trim() || sending}>
                            {sending ? "Sending…" : "Send"}
                          </button>
                        </form>
                      )}
                    </div>
                    {deal.status === "accepted" && (
                      <button className="button button-outline deal-fulfill-button" type="button" onClick={() => updateStatus(deal.id, "fulfill")}>
                        Mark as fulfilled
                      </button>
                    )}
                  </>
                )}
                {deal.status === "fulfilled" && (
                  <p className="deal-fulfilled-note">
                    Marked fulfilled by {deal.fulfilledBy === creatorType ? "you" : accountType === "user" ? businessName : "the customer"}.
                  </p>
                )}
                {deal.status === "declined" && <p className="deal-fulfilled-note">This proposal was respectfully declined.</p>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActiveDealsView({ accountType, accountId, onOpenDeal, otherService = "" }) {
  const [deals, setDeals] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendingDealId, setSendingDealId] = useState("");
  const isServiceProvider = accountType === "serviceProvider";
  const isServiceCustomer = accountType === "serviceCustomer";
  const isServiceDeal = isServiceProvider || isServiceCustomer;
  const dealsUrl = accountType === "business"
    ? "/api/business/deals"
    : isServiceProvider
      ? "/api/service-providers/provider-deals"
      : isServiceCustomer
        ? "/api/service-providers/deals"
        : "/api/neighborhood/deals";
  const activeDealsUrl = `${dealsUrl}/active`;

  useEffect(() => {
    let active = true;
    const refreshDeals = () => {
      request(activeDealsUrl)
        .then(({ deals: loaded }) => {
          if (active) setDeals(loaded);
        })
        .catch((loadError) => {
          if (active) setError(loadError.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    refreshDeals();
    const socket = io({ withCredentials: true });
    socket.on("business-deal:update", (deal) => {
      const belongsToAccount = accountType === "business"
        ? deal.businessId === accountId
        : isServiceProvider
          ? deal.serviceProviderId === accountId
          : deal.userId === accountId;
      if (belongsToAccount) refreshDeals();
    });
    socket.on("service-deal:update", (deal) => {
      if (!isServiceDeal) return;
      const belongsToAccount = isServiceProvider
        ? deal.serviceProviderId === accountId
        : deal.userId === accountId;
      if (belongsToAccount) refreshDeals();
    });
    socket.on("connect_error", () => {
      if (active) setError("Live deal updates are reconnecting. Refresh to check the latest status.");
    });
    return () => {
      active = false;
      socket.disconnect();
    };
  }, [activeDealsUrl, accountType, accountId]);

  async function updateStatus(dealId, action) {
    setError("");
    try {
      const { deal: updatedDeal } = await request(
        `${dealsUrl}/${encodeURIComponent(dealId)}/status`,
        { method: "POST", body: JSON.stringify({ action }) },
      );
      setDeals((current) => current
        .map((deal) => deal.id === updatedDeal.id ? { ...deal, ...updatedDeal } : deal)
        .filter((deal) => deal.status === "pending" || deal.status === "accepted"));
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  async function sendReply(event, dealId) {
    event.preventDefault();
    const content = (drafts[dealId] || "").trim();
    if (!content || sendingDealId) return;
    setSendingDealId(dealId);
    setError("");
    try {
      const { deal: updatedDeal } = await request(
        `${dealsUrl}/${encodeURIComponent(dealId)}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setDeals((current) => current.map((deal) =>
        deal.id === updatedDeal.id ? { ...deal, ...updatedDeal } : deal,
      ));
      setDrafts((current) => ({ ...current, [dealId]: "" }));
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSendingDealId("");
    }
  }

  const partyName = (deal) => accountType === "business" || isServiceProvider
    ? deal.customer?.name || "Customer"
    : isServiceCustomer
      ? deal.provider?.name || "Service provider"
      : deal.business?.businessName || "Business";

  return (
    <section className="active-deals-page" aria-labelledby="active-deals-heading">
      <header className="connections-heading">
        <div>
          <p className="eyebrow">Deal center</p>
          <h2 id="active-deals-heading">Active deals</h2>
          <p>Keep up with proposals and continue accepted deal conversations.</p>
        </div>
        <span className="people-count">{deals.length} active</span>
      </header>
      {error && <p className="chat-error" role="alert">{error}</p>}
      {loading ? (
        <p className="deal-empty">Loading active deals…</p>
      ) : deals.length === 0 ? (
        <div className="deal-empty">
          <strong>No active deals right now.</strong>
          <span>New proposals and accepted deals will appear here.</span>
        </div>
      ) : (
        <div className="active-deals-list">
          {deals.map((deal) => {
            const lastMessage = Array.isArray(deal.messages) ? deal.messages.at(-1) : null;
            const lastMessageText = lastMessage?.content || deal.proposal;
            const subject = (typeof deal.proposal === "string" ? deal.proposal : "Service deal").split(/\r?\n/, 1)[0];
            const currentCreatorType = isServiceCustomer ? "user" : accountType;
            const canRespond = deal.status === "pending" && deal.creatorType !== currentCreatorType;
            return (
              <article className="active-deal-card" key={deal.id}>
                <button className="active-deal-summary" type="button" onClick={() => onOpenDeal(deal)}>
                  <span className="active-deal-summary-heading">
                    <strong>{partyName(deal)}</strong>
                    <span className={`deal-status active-deal-status-${deal.status}`}>
                      {deal.status === "pending" ? "Awaiting response" : deal.autoAccepted ? "Order · Auto-accepted" : "Accepted · Active"}
                    </span>
                  </span>
                  <span className="active-deal-subject"><b>Subject:</b> {subject}</span>
                  {isServiceDeal && deal.serviceName && <span className="service-message-tag">{deal.serviceName === "Other" ? deal.provider?.otherService || otherService || "Other" : deal.serviceName}</span>}
                  {Array.isArray(deal.orderItems) && (
                    <span className="active-deal-order-summary">
                      Product order · {deal.orderItems.length} {deal.orderItems.length === 1 ? "product" : "products"} · ₹{Number(deal.orderTotal || 0).toFixed(2)}
                    </span>
                  )}
                  <span className="active-deal-last-message">
                    <b>Last message:</b> {lastMessageText}
                  </span>
                  <span className="active-deal-open-hint">Open full deal →</span>
                </button>
                <ProductOrderDetails deal={deal} />
                {canRespond && (
                  <div className="deal-actions active-deal-actions">
                    <button className="button button-primary" type="button" onClick={() => updateStatus(deal.id, "accept")}>Accept proposal</button>
                    <button className="button button-outline" type="button" onClick={() => updateStatus(deal.id, "pass")}>Not at this time</button>
                  </div>
                )}
                {deal.status === "accepted" && (
                  <form className="active-deal-reply" onSubmit={(event) => sendReply(event, deal.id)}>
                    <label className="sr-only" htmlFor={`active-deal-reply-${deal.id}`}>Reply to {partyName(deal)} about this deal</label>
                    <input
                      id={`active-deal-reply-${deal.id}`}
                      value={drafts[deal.id] || ""}
                      onChange={(event) => setDrafts((current) => ({ ...current, [deal.id]: event.target.value }))}
                      maxLength={2000}
                      placeholder="Reply about this deal…"
                      disabled={sendingDealId === deal.id}
                    />
                    <button className="button button-primary" type="submit" disabled={!drafts[deal.id]?.trim() || Boolean(sendingDealId)}>
                      {sendingDealId === deal.id ? "Sending…" : "Reply"}
                    </button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProductOrderDetails({ deal }) {
  const [expanded, setExpanded] = useState(false);
  if (!Array.isArray(deal.orderItems) || deal.orderItems.length === 0) return null;

  return (
    <section className="product-order-details" aria-label="Products in this deal">
      <header>
        <div>
          <strong>Product order · auto-accepted</strong>
          <span>{deal.orderItems.length} {deal.orderItems.length === 1 ? "product" : "products"} · ₹{Number(deal.orderTotal || 0).toFixed(2)}</span>
        </div>
        <button
          className="button button-outline"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Hide products" : "View products"}
        </button>
      </header>
      {expanded && (
        <ul>
          {deal.orderItems.map((item) => (
            <li key={item.productId}>
              <span className="product-order-item-name">
                <strong>{item.name}</strong>
                <span>Qty {item.quantity}</span>
                {item.discountPercent > 0 && <span>{item.discountPercent}% discount</span>}
              </span>
              <span className="product-order-item-price">
                {item.discountPercent > 0 && <del>₹{Number(item.originalUnitPrice).toFixed(2)}</del>}
                <strong>₹{Number(item.unitPrice).toFixed(2)} each</strong>
                <span>₹{Number(item.lineTotal).toFixed(2)}</span>
              </span>
            </li>
          ))}
          <li className="product-order-total">
            <strong>Agreed total</strong>
            <strong>₹{Number(deal.orderTotal || 0).toFixed(2)}</strong>
          </li>
        </ul>
      )}
    </section>
  );
}

function NeighborhoodDashboard({ user, onSignOut, onUserUpdated, initialLastSection }) {
  const [people, setPeople] = useState([]);
  const [connectionPeople, setConnectionPeople] = useState([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [pendingConnectionCount, setPendingConnectionCount] = useState(0);
  const [activeView, setActiveView] = useState(
    initialLastSection === "business" ? "businesses" : "messages",
  );
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
  const [businessChatMode, setBusinessChatMode] = useState("messages");
  const [focusedBusinessDealId, setFocusedBusinessDealId] = useState(null);
  const [cartDealNotice, setCartDealNotice] = useState("");
  const [businessMessages, setBusinessMessages] = useState([]);
  const [businessDraft, setBusinessDraft] = useState("");
  const [businessChatError, setBusinessChatError] = useState("");
  const [businessSending, setBusinessSending] = useState(false);
  const [loadingBusinessMessages, setLoadingBusinessMessages] = useState(false);
  const [sectionError, setSectionError] = useState("");
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const selectedPersonRef = useRef(selectedPerson);
  const selectedBusinessRef = useRef(selectedBusiness);
  const activeViewRef = useRef(activeView);
  const connectionSearchRef = useRef(connectionSearch);
  const searchRef = useRef(search);
  const lastSectionRef = useRef(initialLastSection === "business" ? "business" : "community");
  const sectionUpdateQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    selectedPersonRef.current = selectedPerson;
  }, [selectedPerson]);

  useEffect(() => {
    selectedBusinessRef.current = selectedBusiness;
  }, [selectedBusiness]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  function navigateToView(nextView) {
    setActiveView(nextView);
    const nextSection = ["businesses", "businessChats", "activeDeals"].includes(nextView)
      ? "business"
      : "community";
    if (lastSectionRef.current === nextSection) return;
    const previousSection = lastSectionRef.current;
    lastSectionRef.current = nextSection;
    setSectionError("");
    sectionUpdateQueueRef.current = sectionUpdateQueueRef.current
      .catch(() => {})
      .then(() => request("/api/auth/last-section", {
        method: "POST",
        body: JSON.stringify({ section: nextSection }),
      }))
      .catch((sectionUpdateError) => {
        lastSectionRef.current = previousSection;
        setSectionError(sectionUpdateError.message);
      });
  }

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

    socket.on("business-deal:update", (deal) => {
      if (deal.userId !== user.id) return;
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
    setBusinessChatMode("messages");
    setBusinessChatError("");
    navigateToView("businessChats");
  }

  function openPlacedCartDeal(deal, business, notice = "") {
    setSelectedBusiness(business);
    setFocusedBusinessDealId(deal.id);
    setBusinessChatMode("deals");
    setCartDealNotice(notice);
    setBusinessChatError("");
    navigateToView("businessChats");
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

  async function createDealFromMessage(proposal) {
    if (!selectedBusiness) throw new Error("Select a business conversation first.");
    await request(`/api/neighborhood/businesses/${encodeURIComponent(selectedBusiness.id)}/deals`, {
      method: "POST",
      body: JSON.stringify({ proposal }),
    });
    setBusinessConversations((current) => {
      return [
        {
          business: selectedBusiness,
          lastMessage: {
            content: proposal,
            createdAt: new Date().toISOString(),
            type: "deal",
          },
        },
        ...current.filter((item) => item.business.id !== selectedBusiness.id),
      ];
    });
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
            onClick={() => navigateToView("messages")}
          >
            Messages
          </button>
          <button
            className={`nav-button${activeView === "connections" ? " active" : ""}`}
            type="button"
            onClick={() => navigateToView("connections")}
          >
            Connect
            {pendingConnectionCount > 0 && (
              <span className="nav-count" aria-label={`${pendingConnectionCount} pending requests`}>
                {pendingConnectionCount}
              </span>
            )}
          </button>
          <button
            className={`nav-button${["businesses", "businessChats", "activeDeals"].includes(activeView) ? " active" : ""}`}
            type="button"
            onClick={() => navigateToView(
              ["businesses", "businessChats", "activeDeals"].includes(activeView)
                ? activeView
                : "businesses",
            )}
          >
            Business
          </button>
          <button
            className={`nav-button${activeView === "services" ? " active" : ""}`}
            type="button"
            onClick={() => navigateToView("services")}
          >
            Services
          </button>
          <button
            className={`nav-button${activeView === "profile" ? " active" : ""}`}
            type="button"
            onClick={() => navigateToView("profile")}
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
          {["businesses", "businessChats", "activeDeals"].includes(activeView) ? (
            <>
              <p className="eyebrow">Local business</p>
              <h1>Explore businesses in your area.</h1>
              <p className="community-subtitle">Discover local businesses, manage chats, and follow your deals.</p>
            </>
          ) : activeView === "services" ? (
            <>
              <p className="eyebrow">Local services</p>
              <h1>Find skilled help in your area.</h1>
              <p className="community-subtitle">Discover nearby professionals, chat, and agree on a service deal.</p>
            </>
          ) : (
            <>
              <p className="eyebrow">Your neighborhood</p>
              <h1>Good to have you here, {user.name.split(" ")[0]}.</h1>
              <p className="community-subtitle">Meet people in your area and start a conversation.</p>
            </>
          )}
        </div>
        <div className="area-badge">
          <span aria-hidden="true">⌖</span>
          <span>Area pincode <strong>{user.pincode}</strong></span>
        </div>
      </section>

      {["businesses", "businessChats", "activeDeals"].includes(activeView) && (
        <nav className="business-section-nav" aria-label="Business section">
          <button
            className={activeView === "businesses" ? "active" : ""}
            type="button"
            aria-current={activeView === "businesses" ? "page" : undefined}
            onClick={() => navigateToView("businesses")}
          >
            Discover businesses
          </button>
          <button
            className={activeView === "businessChats" ? "active" : ""}
            type="button"
            aria-current={activeView === "businessChats" ? "page" : undefined}
            onClick={() => {
              setBusinessChatMode("messages");
              navigateToView("businessChats");
            }}
          >
            Business chats
            {businessConversations.length > 0 && <span className="nav-count">{businessConversations.length}</span>}
          </button>
          <button
            className={activeView === "activeDeals" ? "active" : ""}
            type="button"
            aria-current={activeView === "activeDeals" ? "page" : undefined}
            onClick={() => navigateToView("activeDeals")}
          >
            Active deals
          </button>
        </nav>
      )}
      {sectionError && <p className="chat-error dashboard-error" role="alert">{sectionError}</p>}

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
      ) : activeView === "businesses" ? (
        <BusinessDirectoryView
          businesses={businesses}
          customerId={user.id}
          loading={loadingBusinesses}
          error={businessChatError}
          search={businessSearch}
          onSearch={setBusinessSearch}
          onOpenChat={openBusinessChat}
          onCartDealPlaced={openPlacedCartDeal}
          onBusinessRatingUpdated={(businessId, summary) => {
            setBusinesses((current) => current.map((business) =>
              business.id === businessId ? { ...business, ...summary } : business,
            ));
          }}
        />
      ) : activeView === "activeDeals" ? (
        <ActiveDealsView
          accountType="user"
          accountId={user.id}
          onOpenDeal={(deal) => {
            setSelectedBusiness(deal.business);
            setFocusedBusinessDealId(deal.id);
            setBusinessChatMode("deals");
            navigateToView("businessChats");
          }}
        />
      ) : activeView === "businessChats" && businessChatMode === "deals" && selectedBusiness ? (
        <section className="active-deal-detail-view" aria-label="Business deal conversation">
          <button className="button button-outline" type="button" onClick={() => setBusinessChatMode("messages")}>
            ← Business messages
          </button>
          {cartDealNotice && <p className="profile-feedback" role="status">{cartDealNotice}</p>}
          <DealCenter
            accountType="user"
            userId={user.id}
            businessId={selectedBusiness.id}
            businessName={selectedBusiness.businessName}
            focusedDealId={focusedBusinessDealId}
          />
        </section>
      ) : activeView === "businessChats" ? (
        <BusinessChatsView
          conversations={businessConversations}
          userId={user.id}
          selectedBusiness={selectedBusiness}
          messages={businessMessages}
          draft={businessDraft}
          error={businessChatError}
          sending={businessSending}
          loadingMessages={loadingBusinessMessages}
          messagesEndRef={messagesEndRef}
          onSelectBusiness={(business) => {
            setSelectedBusiness(business);
            setBusinessChatMode("messages");
            setBusinessChatError("");
          }}
          onBrowseBusinesses={() => navigateToView("businesses")}
          onDraftChange={setBusinessDraft}
          onSendMessage={sendBusinessMessage}
          onCreateDeal={createDealFromMessage}
        />
      ) : activeView === "services" ? (
        <ServicesMarketplace user={user} />
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
                      <button className="button button-outline" type="button" onClick={() => navigateToView("businesses")}>Browse businesses</button>
                    </div>
                  ) : businessConversations.map(({ business, lastMessage }) => (
                    <button
                      className={`person-row${selectedBusiness?.id === business.id ? " selected" : ""}`}
                      key={business.id}
                      type="button"
                      onClick={() => {
                        setSelectedBusiness(business);
                        setBusinessChatMode("messages");
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
  const [serviceProviderForm, setServiceProviderForm] = useState(emptyServiceProviderForm);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [serviceSearch, setServiceSearch] = useState("");
  const [user, setUser] = useState(null);
  const [lastSection, setLastSection] = useState("community");
  const [business, setBusiness] = useState(null);
  const [serviceProvider, setServiceProvider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [error, setError] = useState("");
  const [businessPhotoFiles, setBusinessPhotoFiles] = useState([]);
  const businessPhotoInputRef = useRef(null);

  useEffect(() => {
    request("/api/auth/me")
      .then(({ user: currentUser, lastSection: savedSection }) => {
        setUser(currentUser);
        setLastSection(savedSection === "business" ? "business" : "community");
      })
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
            if (businessError.status !== 401) {
              setError(businessError.message);
              return;
            }
            request("/api/service-providers/me")
              .then(({ serviceProvider: currentProvider }) => {
                setServiceProvider(currentProvider);
                setAccountType("serviceProvider");
              })
              .catch((providerError) => {
                if (providerError.status !== 401) setError(providerError.message);
              });
          });
      })
      .finally(() => setLoading(false));
    request("/api/service-providers/catalog")
      .then(({ services }) => setServiceCatalog(services))
      .catch((catalogError) => setError(catalogError.message));
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

  function updateServiceProviderField(event) {
    const { name, value } = event.target;
    setServiceProviderForm((current) => ({ ...current, [name]: value }));
    if (name === "pincode") setLocationStatus("");
  }

  function updateCredentialField(event) {
    const { name, value } = event.target;
    if (accountType === "business") {
      setBusinessForm((current) => ({ ...current, [name]: value }));
    } else if (accountType === "serviceProvider") {
      setServiceProviderForm((current) => ({ ...current, [name]: value }));
    } else {
      setForm((current) => ({ ...current, [name]: value }));
    }
  }

  function detectServiceProviderLocation() {
    setError("");
    setLocationStatus("Waiting for your location permission…");
    if (!navigator.geolocation) {
      setLocationStatus("Location is not supported by this browser. Enter your pincode instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setServiceProviderForm((current) => ({
          ...current,
          locationConsent: true,
          latitude: String(coords.latitude),
          longitude: String(coords.longitude),
        }));
        try {
          const result = await request(
            `/api/location/reverse?lat=${encodeURIComponent(coords.latitude)}&lon=${encodeURIComponent(coords.longitude)}`,
          );
          setServiceProviderForm((current) => ({ ...current, pincode: result.pincode || current.pincode }));
          setLocationStatus(result.pincode
            ? `Pincode found: ${result.pincode}. Your coordinates will be saved only with your permission.`
            : "Location saved with your permission. Enter your pincode manually.");
        } catch (locationError) {
          setLocationStatus(`${locationError.message} You can enter your pincode manually.`);
        }
      },
      (locationError) => {
        const messages = {
          1: "Location permission wasn’t granted. Enter your pincode instead.",
          2: "Your location couldn’t be determined. Enter your pincode instead.",
          3: "Location lookup timed out. Enter your pincode instead.",
        };
        setLocationStatus(messages[locationError.code] || "Location lookup failed. Enter your pincode instead.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
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
      if (accountType === "serviceProvider" && mode === "signup") {
        const result = await request("/api/service-providers/signup", {
          method: "POST",
          body: JSON.stringify({
            ...serviceProviderForm,
            latitude: serviceProviderForm.locationConsent ? Number(serviceProviderForm.latitude) : null,
            longitude: serviceProviderForm.locationConsent ? Number(serviceProviderForm.longitude) : null,
          }),
        });
        setServiceProvider(result.serviceProvider);
        setServiceProviderForm((current) => ({ ...current, password: "" }));
      } else if (accountType === "serviceProvider") {
        const result = await request("/api/service-providers/signin", {
          method: "POST",
          body: JSON.stringify({ email: serviceProviderForm.email, password: serviceProviderForm.password }),
        });
        setServiceProvider(result.serviceProvider);
        setServiceProviderForm((current) => ({ ...current, password: "" }));
      } else if (accountType === "business" && mode === "signup") {
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
        setLastSection("community");
      } else {
        const result = await request("/api/auth/signin", {
          method: "POST",
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        setForm((current) => ({ ...current, password: "" }));
        setUser(result.user);
        setLastSection(result.lastSection === "business" ? "business" : "community");
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
      setServiceProvider(null);
      setForm(emptyForm);
      setBusinessForm(emptyBusinessForm);
      setServiceProviderForm(emptyServiceProviderForm);
      setMode("signin");
    } catch (signOutError) {
      setError(signOutError.message);
    }
  }

  if (loading) {
    return <main className="loading-screen">Getting your neighborhood ready…</main>;
  }

  if (user) {
    return (
      <NeighborhoodDashboard
        user={user}
        onSignOut={signOut}
        onUserUpdated={setUser}
        initialLastSection={lastSection}
      />
    );
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
  if (serviceProvider) {
    return (
      <ServiceProviderDashboard
        serviceProvider={serviceProvider}
        serviceCatalog={serviceCatalog}
        onServiceProviderUpdated={setServiceProvider}
        onSignOut={async () => {
          try {
            await request("/api/service-providers/signout", { method: "POST" });
            setServiceProvider(null);
            setServiceProviderForm(emptyServiceProviderForm);
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
  const isServiceProvider = accountType === "serviceProvider";

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
              className={isServiceProvider ? "account-type-tab active" : "account-type-tab"}
              type="button"
              role="tab"
              aria-selected={isServiceProvider}
              onClick={() => changeAccountType("serviceProvider")}
            >
              Service provider
            </button>
            <button
              className={!isBusiness && !isServiceProvider ? "account-type-tab active" : "account-type-tab"}
              type="button"
              role="tab"
              aria-selected={!isBusiness && !isServiceProvider}
              onClick={() => changeAccountType("neighborhood")}
            >
              Neighborhood
            </button>
          </div>
          <p className="eyebrow form-eyebrow">
            {isBusiness
              ? isSignup ? "Create your business profile" : "Business portal"
              : isServiceProvider
                ? isSignup ? "Join as a service provider" : "Service provider portal"
                : isSignup ? "Join your neighborhood" : "Welcome back"}
          </p>
          <h2>
            {isBusiness
              ? isSignup ? "Bring your business closer." : "Welcome back."
              : isServiceProvider
                ? isSignup ? "Bring your skills nearby." : "Welcome back."
                : isSignup ? "Make yourself at home." : "Good to see you again."}
          </h2>
          <p className="form-intro">
            {isBusiness
              ? isSignup
                ? "Introduce your business to the community and showcase what you offer."
                : "Sign in to manage your business profile and photos."
              : isServiceProvider
                ? isSignup
                  ? "List your services so nearby customers can contact you and agree on a deal."
                  : "Sign in to update your service profile and manage customer conversations."
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
            ) : isServiceProvider && isSignup ? (
              <>
                <div className="field">
                  <label htmlFor="serviceProviderName">Your name <span className="required">*</span></label>
                  <input id="serviceProviderName" name="name" autoComplete="name" maxLength="80" placeholder="Your full name" value={serviceProviderForm.name} onChange={updateServiceProviderField} required />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="serviceProviderPhone">Phone number <span className="required">*</span></label>
                    <input id="serviceProviderPhone" name="phone" type="tel" autoComplete="tel" maxLength="20" placeholder="+91 98765 43210" value={serviceProviderForm.phone} onChange={updateServiceProviderField} required />
                  </div>
                  <div className="field">
                    <label htmlFor="serviceProviderExperience">Years of experience <span className="optional">Optional</span></label>
                    <input id="serviceProviderExperience" name="yearsExperience" type="number" min="0" max="80" value={serviceProviderForm.yearsExperience} onChange={updateServiceProviderField} />
                  </div>
                </div>
                <div className="field">
                  <div className="label-line">
                    <label htmlFor="serviceProviderPincode">Area pincode <span className="required">*</span></label>
                    <button className="location-button" type="button" onClick={detectServiceProviderLocation}>
                      <span aria-hidden="true">⌖</span> Use my location
                    </button>
                  </div>
                  <input id="serviceProviderPincode" name="pincode" autoComplete="postal-code" inputMode="numeric" maxLength="6" pattern="[0-9]{6}" placeholder="6-digit Indian pincode" value={serviceProviderForm.pincode} onChange={updateServiceProviderField} required />
                  <span className="field-hint">Only customers in your pincode can find your service profile.</span>
                  {locationStatus && <span className="inline-status" role="status">{locationStatus}</span>}
                </div>
                <div className="field">
                  <label>Services you provide <span className="required">*</span></label>
                  <ServiceCatalogPicker
                    catalog={serviceCatalog}
                    selectedServices={serviceProviderForm.services}
                    onServicesChange={(update) => setServiceProviderForm((current) => {
                      const services = typeof update === "function" ? update(current.services) : update;
                      return {
                        ...current,
                        services,
                        serviceDetails: Object.fromEntries(
                          Object.entries(current.serviceDetails).filter(([service]) => services.includes(service)),
                        ),
                      };
                    })}
                    otherService={serviceProviderForm.otherService}
                    onOtherServiceChange={(otherService) => setServiceProviderForm((current) => ({ ...current, otherService }))}
                    search={serviceSearch}
                    onSearchChange={setServiceSearch}
                  />
                </div>
                <ServiceDetailsEditor
                  services={serviceProviderForm.services}
                  serviceDetails={serviceProviderForm.serviceDetails}
                  otherService={serviceProviderForm.otherService}
                  onDetailsChange={(update) => setServiceProviderForm((current) => ({
                    ...current,
                    serviceDetails: typeof update === "function" ? update(current.serviceDetails) : update,
                  }))}
                />
                <div className="field">
                  <label htmlFor="serviceProviderExpertise">Your expertise <span className="optional">Optional</span></label>
                  <textarea id="serviceProviderExpertise" name="expertise" rows="3" maxLength="2000" placeholder="Training, experience, or specialist skills" value={serviceProviderForm.expertise} onChange={updateServiceProviderField} />
                </div>
                <div className="field">
                  <label htmlFor="serviceProviderOffering">What you offer <span className="optional">Optional</span></label>
                  <textarea id="serviceProviderOffering" name="description" rows="3" maxLength="2000" placeholder="Services, availability, and what customers can expect" value={serviceProviderForm.description} onChange={updateServiceProviderField} />
                </div>
              </>
            ) : !isBusiness && !isServiceProvider && isSignup ? (
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
              <label htmlFor="email">{isBusiness ? "Business email" : isServiceProvider ? "Email address" : "Email address"} <span className="required">*</span></label>
              <input id="email" name="email" type="email" autoComplete="email" maxLength="254" placeholder={isBusiness ? "business@example.com" : "you@example.com"} value={isBusiness ? businessForm.email : isServiceProvider ? serviceProviderForm.email : form.email} onChange={updateCredentialField} required />
            </div>
            <div className="field">
              <label htmlFor="password">{isBusiness ? "Business password" : isServiceProvider ? "Password" : "Password"} <span className="required">*</span></label>
              <input id="password" name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 8 : undefined} maxLength="72" placeholder={isSignup ? "At least 8 characters" : "Your password"} value={isBusiness ? businessForm.password : isServiceProvider ? serviceProviderForm.password : form.password} onChange={updateCredentialField} required />
              {isSignup && <span className="field-hint">Use at least 8 characters.</span>}
            </div>

            {error && <p className="form-error" role="alert">{error}</p>}

            {isSignup && isBusiness && (
              <p className="privacy-note">
                Location is optional. If you choose “Use my location,” your coordinates will be saved with your business profile. You can enter the address manually instead.
              </p>
            )}

            {isSignup && isServiceProvider && (
              <p className="privacy-note">
                Location sharing is optional. If you choose “Use my location,” your coordinates are saved with your service profile; your pincode is used to match you with local customers.
              </p>
            )}

            {isSignup && !isBusiness && !isServiceProvider && (
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
              : isServiceProvider
                ? isSignup ? "Already registered as a service provider?" : "New service provider?"
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
