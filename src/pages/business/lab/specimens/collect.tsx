/**
 * 样本采集确认 — 采样护士按条码确认采集信息
 */
import { useState, useEffect } from 'react';
import { Table, Card, Button, Modal, Form, Input, DatePicker, Space, message, Tag } from 'antd';
import { CheckCircleOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { labApplicationDb } from '../../../../providers/lab-db';

export default function SpecimenCollectPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<any>(null);
  const [form] = Form.useForm();

  const fetchData = () => {
    setLoading(true);
    labApplicationDb.list({ status: 'accepted' })
      .then(res => setData(res?.dataInfoList || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleCollect = async (values: any) => {
    if (!currentRecord) return;
    try {
      const payload = {
        applicationId: currentRecord.applicationId,
        sendingOrg: currentRecord.org_sending || 'NX-HOSP-001',
        doctAdviseNo: currentRecord.doctAdviseNo || currentRecord.sp_barcode,
        status: 'collected',
        patientName: currentRecord.patientName,
        sex: currentRecord.sex,
        age: currentRecord.age,
        patientId: currentRecord.patientId,
        patientPhone: currentRecord.patientPhone,
        patientType: currentRecord.patientType,
        diagnostic: currentRecord.diagnostic,
        bedNo: currentRecord.bedNo,
        wardName: currentRecord.wardName,
        sectionName: currentRecord.sectionName,
        requestMode: currentRecord.requestMode,
        requester: currentRecord.requester,
        requestTime: currentRecord.requestTime,
        sendFlag: 0,
        colOrgCode: values.colOrgCode,
        colOrgName: values.colOrgName,
        itemInfoList: currentRecord.itemInfoList || [],
      };
      const res = await labApplicationDb.submit(payload);
      if (res.code === 200) {
        message.success('采集确认成功');
        setModalOpen(false);
        fetchData();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (e: any) {
      message.error(e.message || '操作失败');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Card title="样本采集确认（已受理待采集）">
        <Table
          dataSource={data}
          loading={loading}
          rowKey="applicationId"
          columns={[
            { title: '条码号', dataIndex: 'doctAdviseNo', width: 160, render: (v: string) => v || '—' },
            { title: '患者', dataIndex: 'patientName', width: 100 },
            { title: '性别', dataIndex: 'sex', width: 60 },
            { title: '年龄', dataIndex: 'age', width: 60 },
            { title: '检验项目', dataIndex: 'itemInfoList', width: 200,
              render: (items: any[]) => items?.map((i: any) => i.itemName).join(', ') || '-',
            },
            { title: '状态', dataIndex: 'status', width: 100,
              render: (v: string) => <Tag color="green">{v === 'accepted' ? '已受理' : v}</Tag>,
            },
            { title: '操作', width: 120, render: (_: any, record: any) => (
              <Button
                type="primary"
                size="small"
                icon={<CheckCircleOutlined />}
                onClick={() => { setCurrentRecord(record); form.resetFields(); setModalOpen(true); }}
              >
                采集确认
              </Button>
            )},
          ]}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal title="样本采集确认" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <p>条码号: <strong>{currentRecord?.doctAdviseNo || currentRecord?.sp_barcode || '—'}</strong></p>
        <p>患者: <strong>{currentRecord?.patientName}</strong></p>
        <Form form={form} layout="vertical" onFinish={handleCollect}>
          <Form.Item name="collectTime" label="采集时间" rules={[{ required: true }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="collector" label="采集者" rules={[{ required: true }]}>
            <Input placeholder="采集者姓名" />
          </Form.Item>
          <Form.Item name="collectSite" label="采集部位">
            <Input placeholder="如 肘正中静脉" />
          </Form.Item>
          <Form.Item name="colOrgCode" label="采集机构代码（异地采集时填）">
            <Input placeholder="采集机构代码" />
          </Form.Item>
          <Button type="primary" htmlType="submit">确认采集</Button>
        </Form>
      </Modal>
    </div>
  );
}
