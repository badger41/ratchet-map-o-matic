import { Code, Group, Paper, ScrollArea, Table, Text } from '@mantine/core';
import { formatByteSize } from '../../../lib/format';
import type { PackedFileEntry } from '../../../lib/ratchetPs2Wasm';

interface WadEntryTableProps {
  entries: PackedFileEntry[];
  sourceUrl: string | null;
}

export function WadEntryTable({ entries, sourceUrl }: WadEntryTableProps) {
  return (
    <Paper className="tablePanel" withBorder>
      <Group justify="space-between" className="tableHeader">
        <Text fw={700}>Unpacked Entries</Text>
        <Text size="sm" c="dimmed">
          {sourceUrl ?? 'No source'}
        </Text>
      </Group>
      <ScrollArea className="entryTableScroll">
        <Table stickyHeader striped highlightOnHover withTableBorder={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Path</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th ta="right">Size</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.length > 0 ? entries.map((entry) => (
              <Table.Tr key={`${entry.path}:${entry.offset}`}>
                <Table.Td>
                  <Code className="entryPath">{entry.path}</Code>
                </Table.Td>
                <Table.Td>{entry.contentType || 'application/octet-stream'}</Table.Td>
                <Table.Td ta="right">{formatByteSize(entry.length)}</Table.Td>
              </Table.Tr>
            )) : (
              <Table.Tr>
                <Table.Td colSpan={3}>
                  <Text c="dimmed" ta="center" py="xl">
                    No entries
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}
