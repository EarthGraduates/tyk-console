/**
 * 报告详情 — 完整报告展示（结果明细 + 培养 + 药敏 + 细菌 + 审核日志）
 */
import { useState, useEffect } from 'react';
import { Card, Descriptions, Table, Tag, Tabs, Spin, Typography } from 'antd';
import { useParams } from 'react-router';
import { labReportDb } from '../../../../providers/lab-db';

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending_first_review: { color: 'blue', label: '待一审' },
  pending_second_review: { color: 'orange', label: '待二审' },
  issued: { color: 'green', label: '已签发' },
  rejected: { color: 'red', label: '已退回' },
  canceled: { color: 'default', label: '已撤销' },
};

export default function ReportDetailPage() {
  const { rptId } = useParams<{ rptId: string }>();
  const [report, setReport] = useState<any>(null);
  const [reviewLogs, setReviewLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rptId) return;
    setLoading(true);
    fetch(`/db/lab_test_reports?rpt_id=eq.${rptId}`)
      .then(r => r.json())
      .then(async (rows: any[]) => {
        if (rows?.[0]) {
          const rpt = rows[0];
          const subs = await Promise.all([
            fetch(`/db/lab_report_result_items?report_id=eq.${rpt.id}&limit=200`).then(r => r.json()),
            fetch(`/db/lab_report_plant_items?report_id=eq.${rpt.id}&limit=200`).then(r => r.json()),
            fetch(`/db/lab_report_anti_items?report_id=eq.${rpt.id}&limit=200`).then(r => r.json()),
            fetch(`/db/lab_report_bio_items?report_id=eq.${rpt.id}&limit=200`).then(r => r.json()),
          ]);
          setReport({ ...rpt, results: subs[0], plants: subs[1], antis: subs[2], bios: subs[3] });
          const logRes = await labReportDb.getReviewLogs(rpt.rpt_id);
          setReviewLogs(logRes?.dataInfoList || []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [rptId]);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} size="large" />;
  if (!report) return <Typography.Text>报告未找到</Typography.Text>;

  const status = STATUS_MAP[report.rpt_status] || { color: 'default', label: report.rpt_status };

  return (
    <div style={{ padding: 24 }}>
      <Card title={`检验报告: ${report.rpt_id}`} extra={<Tag color={status.color}>{status.label}</Tag>}>
        <Descriptions bordered column={3} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="条码号">{report.sp_barcode}</Descriptions.Item>
          <Descriptions.Item label="标本号">{report.sp_no || '—'}</Descriptions.Item>
          <Descriptions.Item label="标本类型">{report.sp_type}</Descriptions.Item>
          <Descriptions.Item label="患者姓名">{report.pt_name}</Descriptions.Item>
          <Descriptions.Item label="性别">{report.pt_sex}</Descriptions.Item>
          <Descriptions.Item label="年龄">{report.pt_age}</Descriptions.Item>
          <Descriptions.Item label="送检机构">{report.org_sending_name || report.org_sending}</Descriptions.Item>
          <Descriptions.Item label="临检机构">{report.org_lab}</Descriptions.Item>
          <Descriptions.Item label="采集机构">{report.col_org_code || report.org_sending || '—'}</Descriptions.Item>
          <Descriptions.Item label="临床诊断">{report.pt_diagnostic || '—'}</Descriptions.Item>
          <Descriptions.Item label="一审者">{report.chk_name || '—'}</Descriptions.Item>
          <Descriptions.Item label="二审者">{report.chk_name2 || '—'}</Descriptions.Item>
          <Descriptions.Item label="让步标识">{report.cnc_flag ? <Tag color="orange">让步</Tag> : '正常'}</Descriptions.Item>
        </Descriptions>

        <Tabs defaultActiveKey="results" items={[
          { key: 'results', label: `常规结果 (${report.results?.length || 0})`, children: (
            <Table dataSource={report.results || []} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '项目名称', dataIndex: 'chinese_name', width: 180 },
                { title: '结果值', dataIndex: 'test_result', width: 120 },
                { title: '参考范围', dataIndex: 'ref_range', width: 160 },
                { title: '单位', dataIndex: 'unit', width: 80 },
                { title: '异常提示', dataIndex: 'hint', width: 100, render: (v: string) => v ? <Tag color="red">{v}</Tag> : '—' },
              ]}
            />
          )},
          { key: 'plants', label: `培养 ${report.plants?.length || 0}`, children: (
            <Table dataSource={report.plants || []} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '项目名称', dataIndex: 'chinese_name', width: 180 },
                { title: '结果', dataIndex: 'test_result', width: 120 },
                { title: '培养类型', dataIndex: 'plant_type', width: 100 },
              ]}
            />
          )},
          { key: 'antis', label: `药敏 ${report.antis?.length || 0}`, children: (
            <Table dataSource={report.antis || []} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '抗生素', dataIndex: 'anti_name', width: 160 },
                { title: 'KB 结果', dataIndex: 'kb_result', width: 80 },
                { title: 'MIC 结果', dataIndex: 'mic_result', width: 100 },
                { title: '药敏结果', dataIndex: 'test_result', width: 100, render: (v: string) => <Tag color={v === 'S' ? 'green' : v === 'R' ? 'red' : 'orange'}>{v}</Tag> },
              ]}
            />
          )},
          { key: 'bios', label: `细菌 ${report.bios?.length || 0}`, children: (
            <Table dataSource={report.bios || []} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '细菌名称', dataIndex: 'bio_name', width: 180 },
                { title: '类型', dataIndex: 'bio_type', width: 100 },
                { title: '数量', dataIndex: 'bio_quantity', width: 100 },
              ]}
            />
          )},
          { key: 'logs', label: '审核日志', children: (
            <Table dataSource={reviewLogs} rowKey={(r: any, i?: number) => `${r.reviewTime}-${i ?? 0}`} size="small" pagination={false}
              columns={[
                { title: '操作', dataIndex: 'reviewAction', width: 160 },
                { title: '审核人', dataIndex: 'reviewerName', width: 100 },
                { title: '意见', dataIndex: 'reviewOpinion', width: 200 },
                { title: '时间', dataIndex: 'reviewTime', width: 170 },
              ]}
            />
          )},
        ]} />
      </Card>
    </div>
  );
}
