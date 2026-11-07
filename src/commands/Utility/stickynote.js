
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} from 'discord.js';

import {
    getFromDb,
    setInDb,
    deleteFromDb
} from '../../utils/database.js';

const getStickyKey = (guildId, channelId) =>
    `stickynote:${guildId}:${channelId}`;

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

        const subcommand = interaction.options.getSubcommand();
        const key = getStickyKey(
            interaction.guild.id,
            interaction.channel.id
        );

        if (subcommand === 'set') {
            const content = interaction.options.getString('message');

            const saved = await setInDb(key, {
                content,
                messageId: null
            });

            return interaction.reply({
                content: saved
                    ? '📌 Sticky note saved for this channel!'
                    : 'Failed to save the sticky note.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (subcommand === 'remove') {
            const existing = await getFromDb(key, null);

            if (!existing) {
                return interaction.reply({
                    content: 'There is no sticky note in this channel.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (existing.messageId) {
                await interaction.channel.messages
                    .delete(existing.messageId)
                    .catch(() => {});
            }

            await deleteFromDb(key);

            return interaction.reply({
                content: '🗑️ Sticky note removed!',
                flags: MessageFlags.Ephemeral
            });
        }

        if (subcommand === 'view') {
            const sticky = await getFromDb(key, null);

            return interaction.reply({
                content: sticky
                    ? `📌 **Current sticky note:**\n${sticky.content}`
                    : 'There is no sticky note in this channel.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
