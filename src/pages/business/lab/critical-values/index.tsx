/**
 * 危急值管理 — 查看危急值列表 + 反馈更新
 */
import { useState, useEffect } from 'react';
import { Table, Card, Tag, Typography } from 'antd';
import { labCriticalValueDb } from '../../../../providers/lab-db';

export default function CriticalValuesPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    labCriticalValueDb.list({})
      .then(res => setData(res?.dataInfoList || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <Card title="危急值管理">
        <Typography.Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
          共 {data.length} 条危急值记录
        </Typography.Text>
        <Table
          dataSource={data}
          loading={loading}
          rowKey={(r: any, i?: number) => `${r.doctAdviseNo}-${i ?? 0}`}
          columns={[
            { title: '条码号', dataIndex: 'doctAdviseNo', width: 160 },
            { title: '患者', dataIndex: 'patientName', width: 100 },
            { title: '性别', dataIndex: 'sex', width: 60 },
            { title: '检验者', dataIndex: 'executorName', width: 100 },
            { title: '检验时间', dataIndex: 'executeDate', width: 170 },
            { title: '科室', dataIndex: 'sectionName', width: 120 },
            { title: '危急项', dataIndex: 'warnLogList', width: 280,
              render: (items: any[]) => items?.map((w: any) => (
                <Tag color="red" key={w.testId}>{w.testName}: {w.testResult}</Tag>
              )),
            },
          ]}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}
