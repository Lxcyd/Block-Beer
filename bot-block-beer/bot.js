require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

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

const participants = new Map();
const reminders = new Map();

// Fonction pour valider et formater le lieu
function validateLocation(location) {
  const normalized = location.toLowerCase().trim();

  // Vérifier si le lieu est valide
  const isValid = VALID_LOCATIONS.some(
    (validLoc) =>
      normalized === validLoc ||
      normalized.replace(/[- ]/g, "") === validLoc.replace(/[- ]/g, "")
  );

  if (!isValid) return null;

  // Retourner la version capitalisée
  if (normalized.includes("laennec")) return "Laennec";
  if (normalized.includes("part") || normalized.includes("dieu"))
    return "Part Dieu";
  if (normalized.includes("villeurbanne")) return "Villeurbanne";
  if (normalized.includes("gerland")) return "Climb Up Gerland";
  if (normalized.includes("confluence")) return "Climb Up Confluence";

  return null;
}

// Fonction pour valider et parser l'heure
function validateAndParseHeure(heureStr) {
  let normalized = heureStr.toLowerCase().replace(/[,. ]/g, "h");
  if (!normalized.includes("h")) normalized += "h";

  const parts = normalized.split("h");
  const hours = parseInt(parts[0]);
  const minutes = parts[1] ? parseInt(parts[1]) : 0;

  // Validation
  if (isNaN(hours) || hours < 7 || hours > 23) return null;
  if (isNaN(minutes) || minutes < 0 || minutes > 59) return null;

  // Format de sortie
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes.toString().padStart(2, "0")}`;
}

// Fonction pour parser la date
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

    // Si la date est dans le passé (avant aujourd'hui), ajouter un an
    // On compare sans les heures pour ne regarder que la date
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

// Fonction pour obtenir le nom du jour en français (ou "Aujourd'hui")
function getDayName(date, originalDateStr) {
  // Si c'est aujourd'hui
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

// Fonction pour créer un timestamp Discord
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

// Fonction pour obtenir la date complète
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

client.once("ready", async () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);

  // Définir l'activité personnalisée du bot
  client.user.setActivity({
    type: 4, // ActivityType.Custom
    name: "customstatus",
    state: "/grimpe",
  });

  try {
    console.log("Enregistrement de la commande slash /grimpe...");

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

    console.log("Commande slash enregistrée avec succès !");
  } catch (error) {
    console.error("Erreur:", error);
  }

  setInterval(checkReminders, 60000);
});

// Fonction pour envoyer un message qui se supprime avec compteur décrémentant
async function sendTemporaryReply(interaction, content, duration = 10000) {
  const seconds = Math.floor(duration / 1000);
  let remaining = seconds;

  const reply = await interaction.reply({
    content: `${content} (Suppression automatique : ${remaining})`,
    ephemeral: true,
  });

  // Décrémenter le compteur chaque seconde
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

// Vérifier les rappels
async function checkReminders() {
  const now = Date.now();

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
          }

          eventReminders.delete(userId);
        } catch (error) {
          console.error("Erreur lors de l'envoi du rappel:", error);
        }
      }
    }
  }
}

// Fonction pour créer l'embed
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

// Gestion des interactions
client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand() && interaction.commandName === "grimpe") {
    // Vérifier si la commande est utilisée dans un channel autorisé
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

    // Validation de la date
    const parsedDate = parseDate(date);
    if (!parsedDate) {
      return sendTemporaryReply(
        interaction,
        '❌ Date invalide ! Utilisez : un jour (lundi, mardi...), une date (25/10), "aujourd\'hui" ou "demain"'
      );
    }

    // Validation de l'heure
    const heure = validateAndParseHeure(heureInput);
    if (!heure) {
      return sendTemporaryReply(
        interaction,
        "❌ Heure invalide ! Utilisez une heure entre 7h et 23h (ex: 18h30, 19h)"
      );
    }

    // Validation du lieu (déjà validé par les choices mais on garde la logique)
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
  }

  if (interaction.isButton()) {
    const messageId = interaction.message.id;
    const eventData = participants.get(messageId);

    if (!eventData) {
      return sendTemporaryReply(
        interaction,
        "❌ Erreur: événement introuvable."
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
      }
    } else if (interaction.customId === "absent") {
      if (!isAlreadyParticipating) {
        await sendTemporaryReply(
          interaction,
          "⚠️ Vous n'êtes pas inscrit à cette session."
        );
      } else {
        eventData.list = eventData.list.filter((p) => p.id !== userId);
        await sendTemporaryReply(
          interaction,
          "❌ Vous avez été retiré de la liste des participants."
        );

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
      }
    } else if (interaction.customId === "reminder") {
      const eventTime = getFullDateTime(eventData.date, eventData.heure);

      if (!eventTime) {
        return sendTemporaryReply(
          interaction,
          "❌ Impossible de créer un rappel pour cette date."
        );
      }

      const reminderTime = eventTime - 60 * 60 * 1000; // Rappel 1h avant
      const now = Date.now();

      if (reminderTime <= now) {
        return sendTemporaryReply(
          interaction,
          "❌ L'événement est déjà passé ou en cours !"
        );
      }

      const eventReminders = reminders.get(messageId);
      if (eventReminders.has(userId)) {
        // Si l'utilisateur a déjà un rappel, on le supprime
        eventReminders.delete(userId);
        return sendTemporaryReply(interaction, "🔕 Rappel supprimé !");
      }

      eventReminders.set(userId, reminderTime);

      await sendTemporaryReply(
        interaction,
        "🔔 Rappel configuré ! Vous serez notifié 1 heure avant le début de la session."
      );
    }
  }
});

client.login(TOKEN);
