migrate((app) => {
  const adminRule = '@request.auth.id != ""';

  let admins;
  try {
    admins = app.findCollectionByNameOrId("admins");
  } catch {
    admins = new Collection({
      type: "auth",
      name: "admins",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: "",
      passwordAuth: {
        enabled: true,
        identityFields: ["email"],
      },
      fields: [
        {
          name: "name",
          type: "text",
          max: 120,
        },
      ],
    });
    app.save(admins);
  }

  try {
    app.findCollectionByNameOrId("players");
  } catch {
    const players = new Collection({
      type: "base",
      name: "players",
      listRule: "",
      viewRule: "",
      createRule: adminRule,
      updateRule: adminRule,
      deleteRule: adminRule,
      fields: [
        {
          name: "name",
          type: "text",
          required: true,
          max: 120,
        },
        {
          name: "photo",
          type: "file",
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_players_name ON players (name COLLATE NOCASE)"
      ],
    });
    app.save(players);
  }

  try {
    app.findCollectionByNameOrId("app_state");
  } catch {
    const state = new Collection({
      type: "base",
      name: "app_state",
      listRule: "",
      viewRule: "",
      createRule: adminRule,
      updateRule: adminRule,
      deleteRule: adminRule,
      fields: [
        {
          name: "key",
          type: "text",
          required: true,
          max: 80,
        },
        {
          name: "value",
          type: "json",
          required: false,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_app_state_key ON app_state (key)"
      ],
    });
    app.save(state);
  }

  const adminEmail = $os.getenv("WVY_ADMIN_EMAIL");
  const adminPassword = $os.getenv("WVY_ADMIN_PASSWORD");
  if (adminEmail && adminPassword) {
    try {
      app.findAuthRecordByEmail("admins", adminEmail);
    } catch {
      const record = new Record(admins);
      record.set("email", adminEmail);
      record.set("password", adminPassword);
      record.set("verified", true);
      record.set("name", "WVY Admin");
      app.save(record);
    }
  }

  const superEmail = $os.getenv("PB_SUPERUSER_EMAIL");
  const superPassword = $os.getenv("PB_SUPERUSER_PASSWORD");
  if (superEmail && superPassword) {
    try {
      app.findAuthRecordByEmail("_superusers", superEmail);
    } catch {
      const superusers = app.findCollectionByNameOrId("_superusers");
      const record = new Record(superusers);
      record.set("email", superEmail);
      record.set("password", superPassword);
      app.save(record);
    }
  }
});
