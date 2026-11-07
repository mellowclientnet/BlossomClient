
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';

import {
    getSticky,
    setSticky,
    removeSticky
} from '../../utils/stickyManager.js';

const MAX_NOTE_LENGTH = 2000;

// Prefix commands (e.g. !stickynote set ...) split arguments on spaces and treat
// ' and " as quote marks, so "Don't spam" would be saved as just "Don". Read the
// text from the original message instead so the note is saved exactly as typed.
function getNoteText(interaction) {
    const parsed = interaction.options.getString('message') ?? '';

    if (!interaction._isPrefixCommand) {
        return parsed;
    }

    const raw = interaction._responseCoordinator?.message?.content;
    const match = raw?.match(/^\s*\S+\s+\S+\s+([\s\S]+)$/);

    return match ? match[1] : parsed;
}

export default {
    data: new SlashCommandBuilder()
        .setName('stickynote')
        .setDescription('Manage the sticky note in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set this channel sticky note')
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('The message to keep visible')
                        .setRequired(true)
                        .setMaxLength(2000)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove this channel sticky note')
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View this channel sticky note')
        ),

    async execute(interaction, config, client) {
        if (!interaction.guild) {
            return interaction.reply({
                content: 'This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: 'You need Manage Messages permission.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Setting a note also posts it, which can take longer than the 3 seconds
        // Discord allows for a first reply, so acknowledge the command right away.
        const deferred = await InteractionHelper.safeDefer(interaction, {
            flags: MessageFlags.Ephemeral
        });
        if (!deferred) return;

        const channel = interaction.channel
            ?? await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);

        if (!channel) {
            return InteractionHelper.safeEditReply(interaction, {
                content: 'I could not access this channel.'
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (subcommand === 'set') {
            const content = getNoteText(interaction).trim();

            if (!content) {
                return InteractionHelper.safeEditReply(interaction, {
                    content: 'Please provide a message for the sticky note.'
                });
            }

            if (content.length > MAX_NOTE_LENGTH) {
                return InteractionHelper.safeEditReply(interaction, {
                    content: `Sticky notes can be at most ${MAX_NOTE_LENGTH} characters long.`
                });
            }

            const { saved, posted } = await setSticky(channel, guildId, content);

            let reply = '📌 Sticky note saved for this channel!';
            if (!saved) {
                reply = 'Failed to save the sticky note.';
            } else if (!posted) {
                reply = '📌 Sticky note saved, but I could not post it. Make sure I have View Channel and Send Messages in this channel.';
            }

            return InteractionHelper.safeEditReply(interaction, { content: reply });
        }

        if (subcommand === 'remove') {
            const removed = await removeSticky(channel, guildId);

            return InteractionHelper.safeEditReply(interaction, {
                content: removed
                    ? '🗑️ Sticky note removed!'
                    : 'There is no sticky note in this channel.'
            });
        }

        if (subcommand === 'view') {
            const sticky = await getSticky(guildId, channel.id);

            return InteractionHelper.safeEditReply(interaction, {
                content: sticky
                    ? `📌 **Current sticky note:**\n${sticky.content}`
                    : 'There is no sticky note in this channel.',
                allowedMentions: { parse: [] }
            });
        }
    }
};
