
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed } from '../../utils/embeds.js';

import {
    setSticky,
    removeSticky,
    listStickies
} from '../../utils/stickyManager.js';

const MAX_NOTE_LENGTH = 2000;
const MAX_LIST_ENTRIES = 25;
const PREVIEW_LENGTH = 80;

// Prefix commands (e.g. !sticky note set ...) split arguments on spaces and treat
// ' and " as quote marks, so "Don't spam" would be saved as just "Don". Read the
// text from the original message instead so the note is saved exactly as typed.
// The message looks like: <prefix>sticky note set <text>
function getNoteText(interaction) {
    const parsed = interaction.options.getString('message') ?? '';

    if (!interaction._isPrefixCommand) {
        return parsed;
    }

    const raw = interaction._responseCoordinator?.message?.content;
    const match = raw?.match(/^\s*\S+\s+\S+\s+\S+\s+([\s\S]+)$/);

    return match ? match[1] : parsed;
}

function preview(content) {
    const oneLine = content.replace(/\s+/g, ' ').trim();
    return oneLine.length > PREVIEW_LENGTH
        ? `${oneLine.slice(0, PREVIEW_LENGTH - 1)}…`
        : oneLine;
}

export default {
    data: new SlashCommandBuilder()
        .setName('sticky')
        .setDescription('Manage sticky notes in this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

        .addSubcommandGroup(group =>
            group
                .setName('note')
                .setDescription('Manage sticky notes')

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
                        .setName('list')
                        .setDescription('List all active sticky notes in this server')
                )
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

        if (subcommand === 'list') {
            const notes = await listStickies(guildId);

            // Only show notes whose channel still exists.
            const active = [];
            for (const note of notes) {
                const noteChannel = interaction.guild.channels.cache.get(note.channelId)
                    ?? await interaction.guild.channels.fetch(note.channelId).catch(() => null);

                if (noteChannel) active.push(note);
            }

            if (active.length === 0) {
                return InteractionHelper.safeEditReply(interaction, {
                    content: 'There are no active sticky notes in this server.'
                });
            }

            const shown = active.slice(0, MAX_LIST_ENTRIES);
            const lines = shown.map(note => `<#${note.channelId}> — ${preview(note.content)}`);

            if (active.length > shown.length) {
                lines.push(`…and ${active.length - shown.length} more`);
            }

            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: `📌 Active sticky notes (${active.length})`,
                    description: lines.join('\n'),
                    color: 'info'
                })],
                allowedMentions: { parse: [] }
            });
        }
    }
};
