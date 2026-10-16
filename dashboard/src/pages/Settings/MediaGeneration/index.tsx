import { Card, Empty, Typography } from "antd";

const { Paragraph, Text } = Typography;

/**
 * Media generation settings panel.
 *
 * This English-only fork ships no media-generation provider integrations, so
 * the panel renders a clear "not configured" empty state instead of offering
 * provider options that are unavailable here.
 */
export function MediaGenerationSettingsPanel() {
  return (
    <Card title="Media generation">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            <Paragraph style={{ marginBottom: 4 }}>
              No media generation provider available.
            </Paragraph>
            <Text type="secondary">
              This build does not include any image or video provider
              integration. Add and configure one on the server to enable media
              generation.
            </Text>
          </div>
        }
      />
    </Card>
  );
}

export default MediaGenerationSettingsPanel;
