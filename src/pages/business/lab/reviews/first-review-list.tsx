/**
 * 报告一审列表 — 中心审核员查看待一审报告队列
 */
import { useState, useEffect } from 'react';
import { Table, Card, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router';
import { labReportDb } from '../../../../providers/lab-db';

export default function FirstReviewListPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    labReportDb.getPendingReviews({ reviewStage: 'first' })
      .then(res => setData(res?.dataInfoList || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <Card title="待一审报告">
        <Typography.Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
          共 {data.length} 条待一审
        </Typography.Text>
        <Table
          dataSource={data}
          loading={loading}
          rowKey="reportId"
          columns={[
            { title: '报告 ID', dataIndex: 'reportId', width: 180 },
            { title: '条码号', dataIndex: 'doctAdviseNo', width: 160 },
            { title: '患者', dataIndex: 'patientName', width: 100 },
            { title: '标本类型', dataIndex: 'sampleType', width: 100 },
            { title: '送检机构', dataIndex: 'sendingOrgName', width: 140 },
            { title: '优先度', dataIndex: 'priority', width: 80,
              render: (v: number) => <Tag color={v === 2 ? 'red' : 'blue'}>{v === 2 ? '急诊' : '平诊'}</Tag>,
            },
            { title: '让步标识', dataIndex: 'concessionFlag', width: 80,
              render: (v: number) => v ? <Tag color="orange">让步</Tag> : null,
            },
            { title: '提交时间', dataIndex: 'reportTime', width: 170 },
          ]}
          onRow={record => ({
            onClick: () => navigate(`/business/lab/reviews/first-review/${record.reportId}`),
            style: { cursor: 'pointer' },
          })}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
