require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const fs = require("fs").promises;
const path = require("path");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CHANNEL_ID = "1430912521833021552";
const ROLE_ID = "1331949912740462652";
const ALLOWED_COMMAND_CHANNELS = ["1331948319626235944", "1331948716961304596"];

const VALID_LOCATIONS = [
  "laennec",
  "part dieu",
  "villeurbanne",
  "climb up gerland",
  "climb up confluence",
];

// Fichiers de sauvegarde
const DATA_DIR = path.join(__dirname, "data");
const PARTICIPANTS_FILE = path.join(DATA_DIR, "participants.json");
const REMINDERS_FILE = path.join(DATA_DIR, "reminders.json");

// Maps pour garder en mémoire (essentiel pour la modification des messages)
const participants = new Map();
const reminders = new Map();

// ===== FONCTIONS DE PERSISTANCE =====

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error("Erreur lors de la création du dossier data:", error);
  }
}

async function saveParticipants() {
  try {
    await ensureDataDir();
    const data = Array.from(participants.entries());
    await fs.writeFile(PARTICIPANTS_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ ${participants.size} événement(s) sauvegardé(s)`);
  } catch (error) {
    console.error("❌ Erreur lors de la sauvegarde des participants:", error);
  }
}

async function loadParticipants() {
  try {
    const data = await fs.readFile(PARTICIPANTS_FILE, "utf8");
    const entries = JSON.parse(data);
    participants.clear();
    entries.forEach(([key, value]) => participants.set(key, value));
    console.log(`✅ ${participants.size} événement(s) chargé(s) en mémoire`);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("ℹ️ Aucun fichier de participants trouvé, démarrage à vide");
    } else {
      console.error("❌ Erreur lors du chargement des participants:", error);
    }
  }
}

async function saveReminders() {
  try {
    await ensureDataDir();
    const data = Array.from(reminders.entries()).map(([messageId, userMap]) => [
      messageId,
      Array.from(userMap.entries()),
    ]);
    await fs.writeFile(REMINDERS_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ ${reminders.size} rappel(s) sauvegardé(s)`);
  } catch (error) {
    console.error("❌ Erreur lors de la sauvegarde des rappels:", error);
  }
}

async function loadReminders() {
  try {
    const data = await fs.readFile(REMINDERS_FILE, "utf8");
    const entries = JSON.parse(data);
    reminders.clear();
    entries.forEach(([messageId, userEntries]) => {
      const userMap = new Map(userEntries);
      reminders.set(messageId, userMap);
    });
    console.log(`✅ ${reminders.size} rappel(s) chargé(s) en mémoire`);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("ℹ️ Aucun fichier de rappels trouvé, démarrage à vide");
    } else {
      console.error("❌ Erreur lors du chargement des rappels:", error);
    }
  }
}

// Nettoyer les événements expirés (3h après l'heure de l'événement)
async function cleanExpiredEvents() {
  const now = Date.now();
  let cleaned = 0;
  const messagesToDelete = [];

  for (const [messageId, eventData] of participants.entries()) {
    const eventTime = getFullDateTime(eventData.date, eventData.heure);

    // Supprimer les événements terminés depuis plus de 3h
    if (eventTime && eventTime < now - 3 * 60 * 60 * 1000) {
      messagesToDelete.push(messageId);
      participants.delete(messageId);
      reminders.delete(messageId);
      cleaned++;

      // Essayer de supprimer le message Discord
      try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        const message = await channel.messages.fetch(messageId);
        await message.delete();
        console.log(
          `🗑️ Message Discord ${messageId} supprimé (événement expiré)`
        );
      } catch (error) {
        console.log(`ℹ️ Message ${messageId} déjà supprimé ou introuvable`);
      }
    }
  }

  if (cleaned > 0) {
    console.log(
      `🧹 ${cleaned} événement(s) expiré(s) supprimé(s) de la mémoire et des fichiers`
    );
    await saveParticipants();
    await saveReminders();
  }
}

// ===== FONCTIONS DE VALIDATION =====

function validateLocation(location) {
  const normalized = location.toLowerCase().trim();

  const isValid = VALID_LOCATIONS.some(
    (validLoc) =>
      normalized === validLoc ||
      normalized.replace(/[- ]/g, "") === validLoc.replace(/[- ]/g, "")
  );

  if (!isValid) return null;

  if (normalized.includes("laennec")) return "Laennec";
  if (normalized.includes("part") || normalized.includes("dieu"))
    return "Part Dieu";
  if (normalized.includes("villeurbanne")) return "Villeurbanne";
  if (normalized.includes("gerland")) return "Climb Up Gerland";
  if (normalized.includes("confluence")) return "Climb Up Confluence";

  return null;
}

function validateAndParseHeure(heureStr) {
  let normalized = heureStr.toLowerCase().replace(/[,. ]/g, "h");
  if (!normalized.includes("h")) normalized += "h";

  const parts = normalized.split("h");
  const hours = parseInt(parts[0]);
  const minutes = parts[1] ? parseInt(parts[1]) : 0;

  if (isNaN(hours) || hours < 7 || hours > 23) return null;
  if (isNaN(minutes) || minutes < 0 || minutes > 59) return null;

  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes.toString().padStart(2, "0")}`;
}

function parseDate(dateStr) {
  const now = new Date();
  const daysOfWeek = [
    "dimanche",
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
  ];

  dateStr = dateStr.toLowerCase().trim();

  if (dateStr === "aujourd'hui" || dateStr === "aujourdhui") {
    return new Date(now);
  }

  if (dateStr === "demain") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  const dayIndex = daysOfWeek.indexOf(dateStr);
  if (dayIndex !== -1) {
    const currentDay = now.getDay();
    let daysToAdd = dayIndex - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysToAdd);
    return targetDate;
  }

  const dateParts = dateStr.split("/");
  if (dateParts.length === 2) {
    const day = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1;
    let year = now.getFullYear();

    if (
      isNaN(day) ||
      isNaN(month) ||
      day < 1 ||
      day > 31 ||
      month < 0 ||
      month > 11
    ) {
      return null;
    }

    let targetDate = new Date(year, month, day);

    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const targetStart = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate()
    );

    if (targetStart < todayStart) {
      targetDate.setFullYear(targetDate.getFullYear() + 1);
    }

    return targetDate;
  }

  return null;
}

function getDayName(date, originalDateStr) {
  if (
    originalDateStr &&
    (originalDateStr.toLowerCase() === "aujourd'hui" ||
      originalDateStr.toLowerCase() === "aujourdhui")
  ) {
    return "Aujourd'hui";
  }

  const days = [
    "Dimanche",
    "Lundi",
    "Mardi",
    "Mercredi",
    "Jeudi",
    "Vendredi",
    "Samedi",
  ];
  return days[date.getDay()];
}

function createTimestamp(dateStr, heureStr, format = "t") {
  try {
    const date = parseDate(dateStr);
    if (!date) return null;

    let heureFormatted = heureStr.replace(/[,.]/, "h");
    let heureParts = heureFormatted.split("h");
    let hours = parseInt(heureParts[0]) || 0;
    let minutes = parseInt(heureParts[1]) || 0;

    date.setHours(hours, minutes, 0, 0);

    const timestamp = Math.floor(date.getTime() / 1000);
    return `<t:${timestamp}:${format}>`;
  } catch (error) {
    return null;
  }
}

function getFullDateTime(dateStr, heureStr) {
  try {
    const date = parseDate(dateStr);
    if (!date) return null;

    let heureFormatted = heureStr.replace(/[,.]/, "h");
    let heureParts = heureFormatted.split("h");
    let hours = parseInt(heureParts[0]) || 0;
    let minutes = parseInt(heureParts[1]) || 0;

    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
  } catch (error) {
    return null;
  }
}

// ===== CLIENT READY =====

client.once("clientReady", async () => {
  console.log(`\n🤖 Bot connecté en tant que ${client.user.tag}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 1. Charger les données sauvegardées EN MÉMOIRE
  console.log("📂 Chargement des données...");
  await loadParticipants();
  await loadReminders();
  console.log(
    `💾 Mémoire: ${participants.size} événement(s), ${reminders.size} rappel(s)\n`
  );

  // 2. Nettoyer les événements expirés
  console.log("🧹 Nettoyage des événements expirés...");
  await cleanExpiredEvents();
  console.log("");

  // 3. Restaurer les messages Discord (reconnexion aux boutons)
  console.log("🔄 Restauration des messages Discord...");
  await restoreMessages();
  console.log("");

  // 4. Configurer l'activité du bot
  client.user.setActivity({
    type: 4,
    name: "customstatus",
    state: "/grimpe",
  });

  // 5. Enregistrer la commande slash
  try {
    console.log("📝 Enregistrement de la commande slash /grimpe...");

    await client.application.commands.create({
      name: "grimpe",
      description: "Organiser une session de grimpe",
      options: [
        {
          name: "date",
          type: 3,
          description: "Date (ex: 25/10, aujourd'hui, demain, lundi)",
          required: true,
        },
        {
          name: "heure",
          type: 3,
          description: "Heure entre 7h et 23h (ex: 18h30, 18, 18.30)",
          required: true,
        },
        {
          name: "localisation",
          type: 3,
          description: "Lieu de la session",
          required: true,
          choices: [
            { name: "Laennec", value: "Laennec" },
            { name: "Part Dieu", value: "Part Dieu" },
            { name: "Villeurbanne", value: "Villeurbanne" },
            { name: "Climb Up Gerland", value: "Climb Up Gerland" },
            { name: "Climb Up Confluence", value: "Climb Up Confluence" },
          ],
        },
        {
          name: "infos",
          type: 3,
          description: "Informations complémentaires",
          required: false,
        },
      ],
    });

    console.log("✅ Commande slash enregistrée avec succès !");
  } catch (error) {
    console.error("❌ Erreur lors de l'enregistrement:", error);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✨ Bot prêt et opérationnel !\n");

  // 6. Intervalles de maintenance
  // Vérifier les rappels toutes les minutes
  setInterval(checkReminders, 60000);

  // Sauvegarder automatiquement toutes les 5 minutes (sécurité)
  setInterval(async () => {
    console.log("💾 Sauvegarde automatique...");
    await saveParticipants();
    await saveReminders();
  }, 5 * 60 * 1000);

  // Nettoyer les événements expirés toutes les heures
  setInterval(async () => {
    console.log("🧹 Nettoyage automatique...");
    await cleanExpiredEvents();
  }, 60 * 60 * 1000);
});

// Restaurer les messages après redémarrage
async function restoreMessages() {
  try {
    const targetChannel = await client.channels.fetch(CHANNEL_ID);
    let restored = 0;
    let deleted = 0;

    for (const [messageId, eventData] of participants.entries()) {
      try {
        // Essayer de récupérer le message Discord
        const message = await targetChannel.messages.fetch(messageId);

        // Recréer l'embed et les boutons pour que les interactions fonctionnent
        const embed = createGrimpeEmbed(
          eventData.date,
          eventData.heure,
          eventData.localisation,
          eventData.infos,
          eventData.author,
          eventData.list,
          eventData.guildId,
          eventData.originalDateStr
        );

        const presentButton = new ButtonBuilder()
          .setCustomId("present")
          .setLabel("Présent")
          .setStyle(ButtonStyle.Success);

        const absentButton = new ButtonBuilder()
          .setCustomId("absent")
          .setLabel("Absent")
          .setStyle(ButtonStyle.Danger);

        const reminderButton = new ButtonBuilder()
          .setCustomId("reminder")
          .setLabel("🔔 Rappel")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(
          presentButton,
          absentButton,
          reminderButton
        );

        // Mettre à jour le message avec les nouveaux boutons (reconnexion)
        await message.edit({ embeds: [embed], components: [row] });
        restored++;
        console.log(`✅ Message ${messageId} restauré et reconnecté`);
      } catch (error) {
        // Si le message n'existe plus, le supprimer de la mémoire et des fichiers
        console.log(
          `❌ Message ${messageId} introuvable, suppression des données`
        );
        participants.delete(messageId);
        reminders.delete(messageId);
        deleted++;
      }
    }

    if (deleted > 0) {
      await saveParticipants();
      await saveReminders();
    }

    console.log(
      `📊 Restauration: ${restored} message(s) reconnecté(s), ${deleted} supprimé(s)`
    );
  } catch (error) {
    console.error("❌ Erreur lors de la restauration des messages:", error);
  }
}

async function sendTemporaryReply(interaction, content, duration = 10000) {
  const seconds = Math.floor(duration / 1000);
  let remaining = seconds;

  const reply = await interaction.reply({
    content: `${content} (Suppression automatique : ${remaining})`,
    ephemeral: true,
  });

  const interval = setInterval(async () => {
    remaining--;
    if (remaining > 0) {
      try {
        await interaction.editReply({
          content: `${content} (Suppression automatique : ${remaining})`,
        });
      } catch (error) {
        clearInterval(interval);
      }
    } else {
      clearInterval(interval);
    }
  }, 1000);

  setTimeout(() => {
    clearInterval(interval);
    interaction.deleteReply().catch(() => {});
  }, duration);
}

async function checkReminders() {
  const now = Date.now();
  let remindersSent = 0;

  for (const [messageId, eventReminders] of reminders.entries()) {
    for (const [userId, reminderTime] of eventReminders.entries()) {
      if (now >= reminderTime) {
        try {
          const user = await client.users.fetch(userId);
          const eventData = participants.get(messageId);

          if (eventData) {
            const timestampTime = createTimestamp(
              eventData.date,
              eventData.heure,
              "t"
            );

            const embed = new EmbedBuilder()
              .setColor("#7d9fbd")
              .setTitle("🔔 Rappel - Session de grimpe")
              .setDescription(
                `La session de grimpe commence dans 1 heure !\n\n` +
                  `**Horaire :** ${timestampTime || eventData.heure}\n` +
                  `**Lieu :** ${eventData.localisation}`
              )
              .setTimestamp();

            await user.send({ embeds: [embed] });
            console.log(
              `🔔 Rappel envoyé à ${user.username} pour l'événement ${messageId}`
            );
            remindersSent++;
          }

          // Supprimer le rappel après l'envoi
          eventReminders.delete(userId);
        } catch (error) {
          console.error("❌ Erreur lors de l'envoi du rappel:", error);
          // Supprimer le rappel même en cas d'erreur pour éviter les boucles
          eventReminders.delete(userId);
        }
      }
    }
  }

  // Sauvegarder après avoir envoyé les rappels
  if (remindersSent > 0) {
    await saveReminders();
  }
}

function createGrimpeEmbed(
  date,
  heure,
  localisation,
  infos,
  author,
  participantsList = [],
  guildId,
  originalDateStr
) {
  const parsedDate = parseDate(date);
  const dayName = getDayName(parsedDate, originalDateStr);
  const timestampTime = createTimestamp(date, heure, "t");

  const embed = new EmbedBuilder().setColor("#7d9fbd").setTimestamp();

  let description = `# Grimpe ${dayName} ${timestampTime} à ${localisation}\n\n`;

  if (infos) {
    description += `*${infos}*\n`;
  }

  const count = participantsList.length;
  const grimpeurText = count > 1 ? "Grimpeurs Inscrits" : "Grimpeur Inscrit";
  description += `### __${count} ${grimpeurText} :__\n`;

  if (participantsList.length > 0) {
    const participantsText = participantsList
      .map((p) => `${p.displayName}`)
      .join("\n");
    description += `*${participantsText}*`;
  } else {
    description += `*Aucun participant pour le moment*`;
  }

  embed.setDescription(description);

  embed.setFooter({
    text: `Organisé par ${author.displayName}`,
    iconURL: author.avatarURL,
  });

  return embed;
}

// ===== GESTION DES INTERACTIONS =====

client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand() && interaction.commandName === "grimpe") {
    if (!ALLOWED_COMMAND_CHANNELS.includes(interaction.channelId)) {
      return sendTemporaryReply(
        interaction,
        "❌ Cette commande ne peut être utilisée que dans les channels autorisés !"
      );
    }

    const date = interaction.options.getString("date");
    const heureInput = interaction.options.getString("heure");
    const localisation = interaction.options.getString("localisation");
    const infos = interaction.options.getString("infos");

    const parsedDate = parseDate(date);
    if (!parsedDate) {
      return sendTemporaryReply(
        interaction,
        '❌ Date invalide ! Utilisez : un jour (lundi, mardi...), une date (25/10), "aujourd\'hui" ou "demain"'
      );
    }

    const heure = validateAndParseHeure(heureInput);
    if (!heure) {
      return sendTemporaryReply(
        interaction,
        "❌ Heure invalide ! Utilisez une heure entre 7h et 23h (ex: 18h30, 19h)"
      );
    }

    const validLocation = validateLocation(localisation);
    if (!validLocation) {
      return sendTemporaryReply(
        interaction,
        "❌ Lieu invalide ! Choisissez : Laennec, Part Dieu, Villeurbanne, Climb Up Gerland ou Climb Up Confluence"
      );
    }

    const member = interaction.member;
    const author = {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: member.nickname || interaction.user.username,
      avatarURL: interaction.user.displayAvatarURL({ dynamic: true }),
    };

    const embed = createGrimpeEmbed(
      date,
      heure,
      validLocation,
      infos,
      author,
      [],
      interaction.guildId,
      date
    );

    const presentButton = new ButtonBuilder()
      .setCustomId("present")
      .setLabel("Présent")
      .setStyle(ButtonStyle.Success);

    const absentButton = new ButtonBuilder()
      .setCustomId("absent")
      .setLabel("Absent")
      .setStyle(ButtonStyle.Danger);

    const reminderButton = new ButtonBuilder()
      .setCustomId("reminder")
      .setLabel("🔔 Rappel")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(
      presentButton,
      absentButton,
      reminderButton
    );

    const targetChannel = await client.channels.fetch(CHANNEL_ID);

    const message = await targetChannel.send({
      embeds: [embed],
      components: [row],
    });

    const pingMessage = await targetChannel.send(`<@&${ROLE_ID}>`);
    setTimeout(() => pingMessage.delete().catch(() => {}), 10000);

    await sendTemporaryReply(interaction, "✅ Session de grimpe créée !");

    // Stocker l'événement EN MÉMOIRE avec le messageId comme clé
    // C'est ce qui permet de modifier le message plus tard !
    participants.set(message.id, {
      date,
      heure,
      localisation: validLocation,
      infos,
      author,
      list: [],
      guildId: interaction.guildId,
      originalDateStr: date,
    });

    reminders.set(message.id, new Map());

    // Sauvegarder immédiatement dans les fichiers
    console.log(`💾 Nouvel événement créé: ${message.id}`);
    await saveParticipants();
    await saveReminders();
  }

  if (interaction.isButton()) {
    const messageId = interaction.message.id;

    // Récupérer l'événement EN MÉMOIRE grâce au messageId
    const eventData = participants.get(messageId);

    if (!eventData) {
      return sendTemporaryReply(
        interaction,
        "❌ Erreur: événement introuvable en mémoire."
      );
    }

    const userId = interaction.user.id;
    const member = interaction.member;
    const displayName = member.nickname || interaction.user.username;
    const userAvatar = interaction.user.displayAvatarURL({ dynamic: true });

    const isAlreadyParticipating = eventData.list.some((p) => p.id === userId);

    if (interaction.customId === "present") {
      if (isAlreadyParticipating) {
        await sendTemporaryReply(interaction, "⚠️ Vous êtes déjà inscrit !");
      } else {
        // Modifier les données EN MÉMOIRE
        eventData.list.push({
          id: userId,
          username: interaction.user.username,
          displayName: displayName,
          avatar: userAvatar,
        });

        await sendTemporaryReply(
          interaction,
          "✅ Vous êtes maintenant inscrit à la session !"
        );

        // Mettre à jour le message Discord
        const updatedEmbed = createGrimpeEmbed(
          eventData.date,
          eventData.heure,
          eventData.localisation,
          eventData.infos,
          eventData.author,
          eventData.list,
          eventData.guildId,
          eventData.originalDateStr
        );
        await interaction.message.edit({ embeds: [updatedEmbed] });

        // Sauvegarder dans le fichier
        console.log(
          `💾 Participant ajouté: ${displayName} -> événement ${messageId}`
        );
        await saveParticipants();
      }
    } else if (interaction.customId === "absent") {
      if (!isAlreadyParticipating) {
        await sendTemporaryReply(
          interaction,
          "⚠️ Vous n'êtes pas inscrit à cette session."
        );
      } else {
        // Modifier les données EN MÉMOIRE
        eventData.list = eventData.list.filter((p) => p.id !== userId);

        await sendTemporaryReply(
          interaction,
          "❌ Vous avez été retiré de la liste des participants."
        );

        // Mettre à jour le message Discord
        const updatedEmbed = createGrimpeEmbed(
          eventData.date,
          eventData.heure,
          eventData.localisation,
          eventData.infos,
          eventData.author,
          eventData.list,
          eventData.guildId,
          eventData.originalDateStr
        );
        await interaction.message.edit({ embeds: [updatedEmbed] });

        // Sauvegarder dans le fichier
        console.log(
          `💾 Participant retiré: ${displayName} -> événement ${messageId}`
        );
        await saveParticipants();
      }
    } else if (interaction.customId === "reminder") {
      const eventTime = getFullDateTime(eventData.date, eventData.heure);

      if (!eventTime) {
        return sendTemporaryReply(
          interaction,
          "❌ Impossible de créer un rappel pour cette date."
        );
      }

      const reminderTime = eventTime - 60 * 60 * 1000;
      const now = Date.now();

      if (reminderTime <= now) {
        return sendTemporaryReply(
          interaction,
          "❌ L'événement est déjà passé ou en cours !"
        );
      }

      const eventReminders = reminders.get(messageId);
      if (eventReminders.has(userId)) {
        // Supprimer le rappel EN MÉMOIRE
        eventReminders.delete(userId);
        console.log(
          `🔕 Rappel supprimé: ${interaction.user.username} -> événement ${messageId}`
        );
        await saveReminders();
        return sendTemporaryReply(interaction, "🔕 Rappel supprimé !");
      }

      // Ajouter le rappel EN MÉMOIRE
      eventReminders.set(userId, reminderTime);
      console.log(
        `🔔 Rappel configuré: ${interaction.user.username} -> événement ${messageId}`
      );
      await saveReminders();

      await sendTemporaryReply(
        interaction,
        "🔔 Rappel configuré ! Vous serez notifié 1 heure avant le début de la session."
      );
    }
  }
});

client.login(TOKEN);
